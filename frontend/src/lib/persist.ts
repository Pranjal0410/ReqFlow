import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onlyRealCode, onlyRealRoutes, onlyRealRuns } from "./restore";
import * as SecureStore from "expo-secure-store";
import {
  DetectedRoute,
  RequestTab,
  HistoryEntry,
  Instruction,
  GeneratedEndpoint,
  GeneratedRoute,
  ApplyOutcome,
  RunRecord,
} from "../types";
import { Variable, isSecretVariable } from "./variables";
import { TimingHistory } from "./timings";
import { ExampleStore, ExampleLimit, coerceLimit } from "./examples";

const KEY = "reqflow.workspace.v1";
const SECRETS_KEY = "reqflow.secrets.v1";

import { isSecretHeader, holdsACredential } from "./variables";
// re-exported so the callers that already take it from here keep working
export { isSecretHeader };

export interface Workspace {
  version: 1;
  baseUrl: string;
  projectName: string;
  routes: DetectedRoute[];
  tabs: RequestTab[];
  activeTabId: string;
  history: HistoryEntry[];
  variables: Variable[];
  timings: TimingHistory;
  // folders already scanned, so the path does not have to be typed out again
  recentScans: string[];
  // the folder behind the current scan. the agent reads style from it when
  // generating code, so it has to outlive the modal that collected it.
  projectPath: string;
  // standing rules the user should not have to repeat. saved here rather than
  // in sessionStorage: the whole point is that they survive closing the app.
  // They are preferences about style, not credentials, so the workspace blob is
  // the right place for them.
  instructions: Instruction[];
  // previous runs per endpoint, kept without being asked. credentials are taken
  // out in examples.ts before anything reaches here, which is what makes storing
  // a response acceptable at all.
  examples: ExampleStore;
  exampleLimit: ExampleLimit;
  // Work the agent did on this project: the code it wrote, the endpoints it
  // drafted, and what happened when each was applied.
  //
  // These were deliberately kept to the session, on the grounds that a draft
  // surviving a restart would be indistinguishable from an endpoint that really
  // exists. That reasoning was half right: the confusion is real, but forgetting
  // is not what prevents it — the sidebar group is headed "Generated" and says
  // "not in the project yet" underneath, which says it plainly and keeps saying
  // it tomorrow. Losing a reviewed diff because the app was closed is the worse
  // failure, and it is the developer's own work being thrown away.
  generatedCode: Record<string, GeneratedEndpoint>;
  generatedRoutes: GeneratedRoute[];
  appliedSummaries: Record<string, ApplyOutcome>;
  runs: RunRecord[];
}

// tabId -> headerName -> value
type Secrets = Record<string, Record<string, string>>;

/* ------------------------------------------------------------------ secrets */

// sessionStorage dies when the browser closes, so a token survives a reload
// but is not left on disk afterwards. on a device the OS keystore does the
// real encryption, which the web has no equivalent of.
async function readSecrets(): Promise<Secrets> {
  try {
    const raw =
      Platform.OS === "web"
        ? globalThis.sessionStorage?.getItem(SECRETS_KEY)
        : await SecureStore.getItemAsync(SECRETS_KEY);
    return raw ? (JSON.parse(raw) as Secrets) : {};
  } catch {
    return {};
  }
}

async function writeSecrets(secrets: Secrets): Promise<void> {
  const raw = JSON.stringify(secrets);
  try {
    if (Platform.OS === "web") {
      globalThis.sessionStorage?.setItem(SECRETS_KEY, raw);
    } else {
      await SecureStore.setItemAsync(SECRETS_KEY, raw);
    }
  } catch {
    // storage full or unavailable. losing a token on reload is survivable,
    // crashing the app over it is not.
  }
}

/* ---------------------------------------------------------------- workspace */

function stripForStorage(tabs: RequestTab[]): { tabs: RequestTab[]; secrets: Secrets } {
  const secrets: Secrets = {};

  const cleaned = tabs.map((tab) => {
    const headers = tab.headers.map((h) => {
      if (holdsACredential(h.key, h.value)) {
        secrets[tab.id] = { ...(secrets[tab.id] || {}), [h.key]: h.value };
        // the row stays so you can see the header existed
        return { ...h, value: "" };
      }
      return h;
    });

    return {
      ...tab,
      headers,
      // a stored response would show a stale result next to a request that
      // has not been sent this session
      response: null,
      loading: false,
      // and assertion outcomes belong to that response, not to the next one
      tests: tab.tests.map((t) => ({ ...t, passed: null })),
      // the rule is worth keeping, the value it caught is not: half of these
      // hold a token, and the variables store already decides what a credential
      // may be written to. Keeping a copy here would put it back on disk beside
      // the rule that fetched it.
      captures: (tab.captures || []).map((c) => ({ ...c, lastValue: null })),
    };
  });

  return { tabs: cleaned, secrets };
}

// variables share the secrets store with headers. a tab id can never collide
// with this because ids are generated from Date.now().
const VAR_SCOPE = "__variables__";

function stripVarsForStorage(vars: Variable[]): { vars: Variable[]; secret: Record<string, string> } {
  const secret: Record<string, string> = {};
  const cleaned = vars.map((v) => {
    if (v.key.trim() && isSecretVariable(v.key) && v.value) {
      secret[v.key] = v.value;
      // the name stays visible so you can see the variable exists
      return { ...v, value: "" };
    }
    return v;
  });
  return { vars: cleaned, secret };
}

function restoreVars(vars: Variable[], secrets: Secrets): Variable[] {
  const held = secrets[VAR_SCOPE];
  if (!held) return vars;
  return vars.map((v) => (held[v.key] ? { ...v, value: held[v.key] } : v));
}

function restoreSecrets(tabs: RequestTab[], secrets: Secrets): RequestTab[] {
  return tabs.map((tab) => {
    const forTab = secrets[tab.id];
    if (!forTab) return tab;
    return {
      ...tab,
      headers: tab.headers.map((h) =>
        forTab[h.key] ? { ...h, value: forTab[h.key] } : h
      ),
    };
  });
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  const { tabs, secrets } = stripForStorage(ws.tabs);
  const { vars, secret } = stripVarsForStorage(ws.variables || []);
  if (Object.keys(secret).length) secrets[VAR_SCOPE] = secret;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...ws, tabs, variables: vars }));
    await writeSecrets(secrets);
  } catch {
    // same reasoning as above, a failed save must not take the app down
  }
}

export async function loadWorkspace(): Promise<Workspace | null> {
  let parsed: any;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // anything written by an older shape is discarded rather than half applied
  if (!parsed || parsed.version !== 1) return null;
  if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;

  const secrets = await readSecrets();
  const tabs = restoreSecrets(parsed.tabs as RequestTab[], secrets);

  // the stored active id could point at a tab that is no longer there
  const activeTabId = tabs.some((t) => t.id === parsed.activeTabId)
    ? parsed.activeTabId
    : tabs[0].id;

  return {
    version: 1,
    baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
    projectName: typeof parsed.projectName === "string" ? parsed.projectName : "ReqFlow",
    routes: Array.isArray(parsed.routes) ? parsed.routes : [],
    tabs,
    activeTabId,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    variables: restoreVars(Array.isArray(parsed.variables) ? parsed.variables : [], secrets),
    // measurements, not credentials, so they ride along in the workspace blob
    timings: parsed.timings && typeof parsed.timings === "object" ? parsed.timings : {},
    recentScans: Array.isArray(parsed.recentScans) ? parsed.recentScans : [],
    projectPath: typeof parsed.projectPath === "string" ? parsed.projectPath : "",
    // A first launch starts with the house rules already on, rather than with an
    // empty panel and a promise that it will learn. They are the conventions the
    // generated code should follow anyway, they are visible, and every one of
    // them can be switched off or deleted like any other.
    instructions: Array.isArray(parsed.instructions)
      ? parsed.instructions.filter(
          (i: any) => i && typeof i.text === "string" && i.text.trim()
        )
      : defaultInstructions(),
    examples: parsed.examples && typeof parsed.examples === "object" ? parsed.examples : {},
    exampleLimit: coerceLimit(parsed.exampleLimit),

    // A workspace saved before these were kept simply has none of them, which is
    // the same state as a session that generated nothing.
    generatedCode: onlyRealCode(parsed.generatedCode),
    generatedRoutes: onlyRealRoutes(parsed.generatedRoutes),
    appliedSummaries:
      parsed.appliedSummaries && typeof parsed.appliedSummaries === "object"
        ? parsed.appliedSummaries
        : {},
    runs: onlyRealRuns(parsed.runs),
  };
}


// The conventions worth following in an Express project whether or not anyone
// says so. Marked as the user's own rather than as something the agent inferred,
// because the agent did not infer them — they shipped with the app, and claiming
// otherwise would make the "picked up from what you said" label a lie.
export function defaultInstructions(): Instruction[] {
  const at = Date.now();
  return [
    "Use camelCase for JSON field names",
    "Validate the request body and answer 400 with a message naming the missing field",
    "Match the style of the file being edited: same quotes, same indentation, same export shape",
    "Return 201 with the created object from a create endpoint",
  ].map((text, i) => ({
    id: `default-${i}`,
    text,
    enabled: true,
    at,
    source: "manual" as const,
  }));
}

export async function clearWorkspace(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
    if (Platform.OS === "web") globalThis.sessionStorage?.removeItem(SECRETS_KEY);
    else await SecureStore.deleteItemAsync(SECRETS_KEY);
  } catch {
    // nothing useful to do if the store will not co-operate
  }
}
