import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { DetectedRoute, RequestTab, HistoryEntry } from "../types";

const KEY = "reqflow.workspace.v1";
const SECRETS_KEY = "reqflow.secrets.v1";

// header names whose value is a credential. these never reach the workspace
// blob, which on web is localStorage and survives until something clears it.
const SECRET_HEADER =
  /^(authorization|cookie|proxy-authorization)$/i;
const SECRET_HINT = /(token|secret|password|api[-_]?key)/i;

export function isSecretHeader(name: string): boolean {
  return SECRET_HEADER.test(name.trim()) || SECRET_HINT.test(name.trim());
}

export interface Workspace {
  version: 1;
  baseUrl: string;
  projectName: string;
  routes: DetectedRoute[];
  tabs: RequestTab[];
  activeTabId: string;
  history: HistoryEntry[];
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
      if (h.key.trim() && isSecretHeader(h.key) && h.value) {
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
    };
  });

  return { tabs: cleaned, secrets };
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
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...ws, tabs }));
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
  };
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
