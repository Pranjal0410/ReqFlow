import React, { useState } from "react";
import { View, StyleSheet, StatusBar, Platform } from "react-native";
import Sidebar from "./src/components/Sidebar";
import TopBar from "./src/components/TopBar";
import AiAgent, { 
  AgentRequestDraft,
  AgentAssertion,
  AgentSentRequest,
} from "./src/components/AiAgent";
import TabBar from "./src/components/TabBar";
import RequestBuilder from "./src/components/RequestBuilder";
import RuntimeTrace from "./src/components/RuntimeTrace";
import ScanModal from "./src/components/ScanModal";
import CodeView from "./src/components/CodeView";
import RunDetail from "./src/components/RunDetail";
import ApplyPreview from "./src/components/ApplyPreview";
import InstructionPanel from "./src/components/InstructionPanel";
import SettingsPanel from "./src/components/SettingsPanel";
import ExamplesPanel from "./src/components/ExamplesPanel";
import Toast from "./src/components/Toast";
import AppStatusBar, { ModelStatus } from "./src/components/StatusBar";
import {
  analyzeProject,
  sendRequest,
  checkTarget,
  exportOpenApi,
  checkModel,
  cancelRun,
  runningProjects,
  stopProject,
  planGenerated,
  applyGenerated,
  verifyGenerated,
  fetchRouteSource,
} from "./src/services/api";
import {
  DetectedRoute,
  RequestTab,
  HistoryEntry,
  GeneratedEndpoint,
  GeneratedRoute,
  ApplyPlan,
  VerifyResult,
  ApplyOutcome,
  AppliedFile,
  RunningProject,
  RunRecord,
  Instruction,
} from "./src/types";
import { colors } from "./src/theme/colors";
import { CONFIG } from "./src/config";
import { runAssertions } from "./src/lib/assertions";
import {
  loadWorkspace,
  saveWorkspace,
  clearWorkspace,
  defaultInstructions,
} from "./src/lib/persist";
import { Variable, toMap, substitute, workspaceAuth } from "./src/lib/variables";
import { runCaptures, withResults } from "./src/lib/capture";
import { withScheme, originOf } from "./src/lib/url";
import {
  addGenerated,
  pruneGenerated,
  toGeneratedRoute,
  routeKey,
} from "./src/lib/generatedRoutes";
import { applyPathParams, matchTemplate } from "./src/lib/pathParams";
import {
  ExampleStore,
  ExampleLimit,
  DEFAULT_EXAMPLE_LIMIT,
  toExample,
  record as recordExample,
  forEndpoint,
} from "./src/lib/examples";
import {
  TimingHistory,
  record as recordTiming,
  compare as compareTimings,
  summarise as summariseTiming,
  endpointKey,
} from "./src/lib/timings";

// One verdict, not two messages. Every number in it was measured by the
// backend — the wait for the server, the statuses the server gave — so none of
// it is an estimate wearing a fact's clothes.
//
// The distinction that matters most is between "did not work" and "could not be
// checked". Code that was written while nothing was listening is not code that
// failed; saying so would send the developer to read a diff that is fine.
export function describeApplied(written: string, result: VerifyResult): ApplyOutcome {
  // Stopped on purpose. Not a failure — nothing was found to be wrong — and not
  // a success either, because nothing was checked.
  if (result.cancelled) {
    return { verdict: "unverified", text: result.message || `${written}. Stopped before checking.` };
  }

  if (!result.ready) {
    return {
      verdict: result.brokeServer ? "failed" : "unverified",
      text: `${written}. ${result.message}`,
    };
  }

  if (result.pickedUp === false) {
    return { verdict: "unverified", text: `${written}. ${result.message}` };
  }

  const calls = [result.create, result.read].filter(Boolean);
  const failed = calls.filter((c) => c!.response.status >= 400);
  const summary = calls
    .map((c) => `${c!.method} ${c!.url.replace(/^https?:\/\/[^/]+/, "")} ${c!.response.status}`)
    .join(", ");

  if (failed.length > 0) {
    const first = failed[0]!;
    return {
      verdict: "failed",
      text: `${written}, but the endpoint did not work: ${first.method} ${first.url.replace(
        /^https?:\/\/[^/]+/,
        ""
      )} returned ${first.response.status}. (${summary})`,
    };
  }

  const waited = `server answered in ${(result.waitedMs / 1000).toFixed(1)}s`;

  // it ran, but nothing read it back, so "it works" is more than was checked
  if (!result.read) {
    return {
      verdict: "unverified",
      text: `${written}, ${waited} — ${summary}. ${result.message || "Nothing read it back."}`,
    };
  }

  return { verdict: "verified", text: `${written}, ${waited} — ${summary}.` };
}

function createTab(baseUrl: string, route?: DetectedRoute): RequestTab {
  const id = Date.now().toString() + Math.random().toString(36).slice(2);
  return {
    id,
    method: route?.method || "GET",
    url: route ? `${baseUrl.replace(/\/+$/, "")}${route.path}` : "",
    body: route?.body ? JSON.stringify(route.body, null, 2) : "",
    headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
    response: null,
    loading: false,
    label: route ? `${route.method} ${route.path}` : "New Request",
    tests: [],
    captures: [],
    pathParams: {},
  };
}

export default function App() {
  const [routes, setRoutes] = useState<DetectedRoute[]>([]);
  const [baseUrl, setBaseUrl] = useState(CONFIG.DEFAULT_TARGET);
  const [tabs, setTabs] = useState<RequestTab[]>([createTab(CONFIG.DEFAULT_TARGET)]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [scanning, setScanning] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showAiAgent, setShowAiAgent] = useState(true);
  const [projectName, setProjectName] = useState("ReqFlow");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  // per endpoint timing samples, so a response can be read against its own past
  const [timings, setTimings] = useState<TimingHistory>({});
  const [recentScans, setRecentScans] = useState<string[]>([]);
  // standing rules the agent follows. saved with the workspace, because a rule
  // the user has to restate after every restart is not a rule they gave once.
  // Seeded, not empty: a first launch already follows the house rules, and the
  // panel shows exactly which ones rather than promising to learn them later.
  const [instructions, setInstructions] = useState<Instruction[]>(defaultInstructions);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // the ids the backend reported putting into the last prompt. the panel shows
  // this rather than assuming every enabled rule arrived.
  const [instructionsSent, setInstructionsSent] = useState<string[] | null>(null);
  // every send is kept as an example of its endpoint. nobody presses save: a
  // button you have to remember only catches the runs you thought would matter.
  const [examples, setExamples] = useState<ExampleStore>({});
  const [exampleLimit, setExampleLimit] = useState<ExampleLimit>(DEFAULT_EXAMPLE_LIMIT);
  const [showExamples, setShowExamples] = useState(false);
  // which model is behind the scan, the code generator and the agent. asked
  // once at startup rather than polled: it changes when the backend restarts,
  // and a check that costs a model call is not one to run on a timer.
  const [model, setModel] = useState<ModelStatus | null>(null);
  // the project ReqFlow started itself. polled rather than assumed: the backend
  // is the only thing that knows, and it can restart underneath the page.
  const [runningProject, setRunningProject] = useState<RunningProject | null>(null);
  // the last few applies, so what happened is still readable after the panel is
  // closed. capped, because this is a short memory of recent work rather than a
  // log — the fifth one back has never been the one anybody wanted.
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // the folder behind the current scan, kept because generated code is written
  // in the style of what is in it
  const [projectPath, setProjectPath] = useState("");
  // source for an endpoint the project does not have yet. it is held rather
  // than shown once, so the log row in the chat can bring it back.
  // Source the agent wrote, kept per endpoint rather than as one "the last
  // one". A run that writes three endpoints leaves three rows in the sidebar,
  // and a single slot would give all three of them the third one's code.
  // Session-only, like the rows themselves.
  const [generatedCode, setGeneratedCode] = useState<Record<string, GeneratedEndpoint>>({});
  const [activeCodeKey, setActiveCodeKey] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  // the applied run being read, kept apart from the code view so a run whose
  // code is no longer on hand still has somewhere to open
  const [openRun, setOpenRun] = useState<RunRecord | null>(null);
  const generated = activeCodeKey ? generatedCode[activeCodeKey] ?? null : null;
  const generatedCodeKeys = React.useMemo(
    () => new Set(Object.keys(generatedCode)),
    [generatedCode]
  );

  // switched off means not sent, so the panel's "switched on" and what reaches
  // the model are the same list rather than two lists that agree most of the time
  const activeInstructions = React.useMemo(
    () => instructions.filter((i) => i.enabled).map((i) => ({ id: i.id, text: i.text })),
    [instructions]
  );
  // the diff between that source and the project it would go into. held apart
  // from the code itself because it is about the files, not the endpoint, and
  // it is rebuilt every time the preview opens rather than cached: the folder
  // is the developer's, and it can have moved on since the code was written.
  const [applyPlan, setApplyPlan] = useState<ApplyPlan | null>(null);
  const [showApply, setShowApply] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  // One piece of state, not two. Whether the write failed and whether that
  // failure has a way out are the same fact, and keeping them apart meant five
  // places cleared the message while two cleared the flag — leaving a "Choose
  // the folder" button attached to an error it could not fix.
  const [applyError, setApplyError] = useState<{
    message: string;
    recoverable: boolean;
  } | null>(null);

  // Choosing the folder is what grants access to it on macOS — the same act
  // that Scan Project performs, offered where the refusal happened so the
  // developer does not have to go back and start again.
  const regrantAndRetry = async () => {
    const desktop = (globalThis as any).reqflowDesktop;
    if (typeof desktop?.chooseProjectFolder !== "function") return;

    const chosen = await desktop.chooseProjectFolder().catch(() => null);
    if (!chosen) return;

    // Choosing a different folder grants that one, not this project. Saying so
    // is better than retrying and failing again for a reason that now looks
    // like the first one.
    const grantsThisProject = stylePath === chosen || (stylePath || "").startsWith(`${chosen}/`);
    if (!grantsThisProject) {
      setApplyError({
        message: `That grants access to ${chosen}, which does not contain this project. Choose ${stylePath} itself, or a folder above it.`,
        recoverable: true,
      });
      return;
    }

    setApplyError(null);
    handleApply();
  };
  const [applying, setApplying] = useState(false);
  // the verification currently under way, so it can be stopped. null when
  // nothing is running, which is also what hides the Cancel.
  const [verifyingRun, setVerifyingRun] = useState<string | null>(null);
  // what the write and the run that followed it actually did, per endpoint.
  // keyed like the code is, so applying one endpoint cannot make another one's
  // panel claim its code is already in the project.
  const [appliedSummaries, setAppliedSummaries] = useState<Record<string, ApplyOutcome>>({});
  const appliedOutcome = activeCodeKey ? appliedSummaries[activeCodeKey] ?? null : null;
  // the evidence behind the verdict: which files were written, and what the
  // backend measured when it ran the endpoint. kept per endpoint, like the
  // verdict itself.
  const [appliedDetail, setAppliedDetail] = useState<
    Record<string, { files: AppliedFile[]; result: VerifyResult | null }>
  >({});
  const appliedEvidence = activeCodeKey ? appliedDetail[activeCodeKey] ?? null : null;
  // endpoints the agent drafted that the scan has not found. deliberately not
  // in the saved workspace: they are suggestions about code that does not
  // exist yet, and one that came back after a restart would look like a real
  // endpoint the project had all along.
  const [generatedRoutes, setGeneratedRoutes] = useState<GeneratedRoute[]>([]);

  // nothing is written back until the saved workspace has been read, otherwise
  // the empty first render would immediately overwrite it
  const [hydrated, setHydrated] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadWorkspace();
      if (!cancelled && saved) {
        setBaseUrl(saved.baseUrl || CONFIG.DEFAULT_TARGET);
        setProjectName(saved.projectName);
        setRoutes(saved.routes);
        setTabs(saved.tabs);
        setActiveTabId(saved.activeTabId);
        setHistory(saved.history);
        setVariables(saved.variables || []);
        setTimings(saved.timings || {});
        setRecentScans(saved.recentScans || []);
        setProjectPath(saved.projectPath || "");
        setInstructions(saved.instructions || []);
        setExamples(saved.examples || {});
        setExampleLimit(saved.exampleLimit || DEFAULT_EXAMPLE_LIMIT);
        // the agent's work, back where it was left. the code view is not
        // reopened: coming back to a modal nobody asked for is its own problem.
        setGeneratedCode(saved.generatedCode || {});
        setGeneratedRoutes(saved.generatedRoutes || []);
        setAppliedSummaries(saved.appliedSummaries || {});
        setRuns(saved.runs || []);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // debounced so typing in the url bar does not write on every keystroke
  React.useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(() => {
      saveWorkspace({
        version: 1,
        baseUrl,
        projectName,
        routes,
        tabs,
        activeTabId,
        history,
        variables,
        timings,
        recentScans,
        projectPath,
        instructions,
        examples,
        exampleLimit,
        // the agent's work on this project, so closing the app does not throw
        // away a diff the developer has already read
        generatedCode,
        generatedRoutes,
        appliedSummaries,
        runs,
      });
    }, 400);
    return () => clearTimeout(id);
  }, [hydrated, baseUrl, projectName, routes, tabs, activeTabId, history, variables, timings, recentScans, projectPath, instructions, examples, exampleLimit, generatedCode, generatedRoutes, appliedSummaries, runs]);

  // what ReqFlow is running, kept current so the offer to stop it is real
  const refreshRunning = React.useCallback(async () => {
    try {
      const list = await runningProjects();
      setRunningProject(list[0] ?? null);
    } catch {
      // the backend being unreachable is reported by the target badge already
    }
  }, []);

  React.useEffect(() => {
    refreshRunning();
    const id = setInterval(refreshRunning, 5000);
    return () => clearInterval(id);
  }, [refreshRunning]);

  const handleStopProject = async () => {
    if (!runningProject) return;
    try {
      const list = await stopProject(runningProject.projectPath);
      setRunningProject(list[0] ?? null);
      // the badge is about a server this app has just stopped, so it is asked
      // again now rather than left saying "responding" until the next tick
      setRecheckTarget((n) => n + 1);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "could not stop it");
    }
  };

  // The window now opens before the backend does, so the first few checks can
  // find nothing there. A backend still starting is not a broken model, and
  // reporting one would be the wrong answer to the wrong question — so this
  // keeps asking for a while before it accepts silence as an answer.
  React.useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    const ask = () => {
      checkModel()
        .then((m) => !cancelled && setModel(m))
        .catch(() => {
          if (cancelled) return;
          attempt++;
          // roughly half a minute, which covers a cold start on a machine that
          // is also unpacking the app for the first time
          if (attempt < 20) setTimeout(ask, 1500);
          else setModel(null);
        });
    };

    ask();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // mirrors activeTabId so the agent handlers can read it without waiting for a
  // re-render
  const activeTabIdRef = React.useRef(activeTabId);
  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // same trick for the tabs themselves, so a handler can build the next list
  // and read back which tab to select without going through an updater
  const tabsRef = React.useRef(tabs);
  React.useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // A workspace saved before this field existed has a scan in it but no path,
  // which would tell someone who has already scanned to go and scan. The most
  // recent entry is that same folder, so it stands in.
  const stylePath = projectPath || recentScans[0] || null;

  // what the agent is told the user is looking at. the response body is capped
  // because a chatty endpoint would otherwise fill the model's context with a
  // payload nobody asked about.
  const activeTabContext = React.useMemo(
    () => ({
      method: activeTab.method,
      url: activeTab.url,
      headers: Object.fromEntries(
        activeTab.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key, h.value])
      ),
      body: activeTab.body,
      response: activeTab.response
        ? {
            status: activeTab.response.status,
            statusText: activeTab.response.statusText,
            timing: activeTab.response.timing.total,
            data: JSON.stringify(activeTab.response.data).slice(0, 4000),
          }
        : null,
      tests: activeTab.tests.map((t) => ({
        field: t.field,
        operator: t.operator,
        value: t.value,
        passed: t.passed,
      })),
    }),
    [activeTab]
  );

  // the active response measured against earlier runs of the same endpoint.
  // the current run is already in the history, so it is excluded here or it
  // would be comparing itself against itself.
  const timingReport = React.useMemo(() => {
    if (!activeTab.response) return { comparisons: [], summary: null };

    const key = endpointKey(activeTab.method, activeTab.url);
    const samples = timings[key] || [];
    const prior: TimingHistory = { ...timings, [key]: samples.slice(0, -1) };

    return {
      comparisons: compareTimings(prior, activeTab.method, activeTab.url, activeTab.response),
      summary: summariseTiming(prior, activeTab.method, activeTab.url, activeTab.response),
    };
  }, [activeTab.response, activeTab.method, activeTab.url, timings]);

  // the server the active request points at. an empty tab falls back to the
  // base url, because saying "no target" right after the user named one reads
  // as the app having ignored them. before a scan that url is still the default
  // nobody chose, so it stays "no target" rather than announcing a server the
  // user has not pointed at.
  const target = React.useMemo(() => {
    const candidates = routes.length > 0 ? [activeTab.url, baseUrl] : [activeTab.url];
    for (const candidate of candidates) {
      const origin = originOf(candidate);
      if (origin) return origin;
    }
    return null;
  }, [activeTab.url, baseUrl, routes.length]);

  // poll it so the status badge reflects reality instead of just asserting it
  const [targetUp, setTargetUp] = useState<boolean | null>(null);
  // bumped when something the app itself did makes the badge wrong before the
  // next tick — stopping the server it was running, most obviously. Fifteen
  // seconds of "responding" after ReqFlow shut the server down is the app
  // reporting a world it has itself just changed.
  const [recheckTarget, setRecheckTarget] = useState(0);

  React.useEffect(() => {
    if (!target) {
      setTargetUp(null);
      return;
    }
    let cancelled = false;
    setTargetUp(null);

    const ping = async () => {
      try {
        const up = await checkTarget(target);
        if (!cancelled) setTargetUp(up);
      } catch {
        if (!cancelled) setTargetUp(false);
      }
    };

    ping();
    const id = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [target, recheckTarget]);

  // One way in for all three places a request gets sent: by hand, by Run all,
  // and by the agent. Credentials are taken out inside toExample(), so no caller
  // has to remember to do it — the one that forgets is the one that writes a
  // token to disk.
  const keepExample = (
    method: string,
    url: string,
    body: string,
    headers: Record<string, string>,
    response: any
  ) => {
    setExamples((prev) =>
      recordExample(
        prev,
        toExample({ method, url, body }, headers, response, Date.now()),
        exampleLimit
      )
    );
  };

  const activeExamples = React.useMemo(
    () => forEndpoint(examples, activeTab.method, activeTab.url),
    [examples, activeTab.method, activeTab.url]
  );

  // What a response hands to the requests after it.
  //
  // Both places a request goes out end up here, because a rule that only worked
  // when you pressed Send by hand — and not under Run all, which is where a
  // login followed by ten calls actually happens — would be the wrong half.
  const applyCaptures = (tab: RequestTab, res: any): Record<string, string> => {
    const found = runCaptures(tab.captures || [], res);
    if (found.length === 0) return {};

    setVariables((prev) => {
      const next = [...prev];
      for (const { name, value } of found) {
        const at = next.findIndex((v) => v.key === name);
        if (at >= 0) next[at] = { key: name, value };
        else next.push({ key: name, value });
      }
      return next;
    });

    const asMap: Record<string, string> = {};
    for (const { name, value } of found) asMap[name] = value;
    return asMap;
  };

  const updateActiveTab = (updates: Partial<RequestTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, ...updates } : t))
    );
  };

  // the base url comes from the modal now: a scan that leaves it at a default
  // points every route it just found at whatever happens to run on port 3000
  const handleScan = async (scannedPath: string, scannedBaseUrl: string) => {
    setScanning(true);
    try {
      const result = await analyzeProject(scannedPath);
      setRoutes(result.routes);
      // a suggestion the user has since written into the project is no longer a
      // suggestion, and the scan is how we find out
      setGeneratedRoutes((prev) => pruneGenerated(prev, result.routes));
      setProjectName(scannedPath.split("/").pop() || "Project");
      setProjectPath(scannedPath);
      setBaseUrl(withScheme(scannedBaseUrl));
      setRecentScans((prev) => [scannedPath, ...prev.filter((p) => p !== scannedPath)].slice(0, 4));
      setShowScan(false);
    } catch (err: any) {
      const detail = err?.response?.data?.error || err?.message || "unknown error";
      setError(`Scan failed: ${detail}`);
    } finally {
      setScanning(false);
    }
  };

  // The code behind an endpoint the project already has.
  //
  // The same panel the agent's endpoints open in, because "show me what serves
  // this" is the same question whether the code was written five minutes ago or
  // five months ago. There is nothing to apply — it is already applied — so the
  // panel names the file it came from instead.
  const [routeSource, setRouteSource] = React.useState<{
    method: string;
    path: string;
    file: string;
    line: number;
    code: string;
  } | null>(null);

  const handleSelectRoute = (route: DetectedRoute) => openRouteTab(route);

  // The code behind an endpoint the project already has, opened from the row's
  // own control. If the handler cannot be found the tab opens instead, so the
  // click is never spent on nothing.
  const handleShowSource = async (route: DetectedRoute) => {
    if (!stylePath) return openRouteTab(route);
    try {
      const found = await fetchRouteSource(stylePath, route.method, route.path);
      if (found.found && found.code) {
        setRouteSource({
          method: route.method,
          path: route.path,
          file: found.file || "",
          line: found.line || 0,
          code: found.code,
        });
        setShowCode(true);
        return;
      }
      setError(found.detail || `No handler for ${route.method} ${route.path} was found.`);
    } catch (err: any) {
      setError(String(err?.message || err));
    }
  };

  const openRouteTab = (route: DetectedRoute) => {
    const url = `${baseUrl.replace(/\/+$/, "")}${route.path}`;
    const open = tabsRef.current.find((t) => t.method === route.method && t.url === url);
    if (open) {
      setActiveTabId(open.id);
      activeTabIdRef.current = open.id;
      return;
    }

    // a fresh one gets the route's own body and params, which the plain helper
    // has nothing to fill them from
    const newTab = createTab(baseUrl, route);

    // once a token is in the workspace, every route opened from the sidebar
    // used to come back 401 until the header was added by hand, one tab at a
    // time. {{token}} rather than the value, so it survives the next login.
    if (toMap(variables).token) {
      newTab.headers = [
        ...newTab.headers,
        { key: "Authorization", value: "Bearer {{token}}", enabled: true },
      ];
    }

    const next = [...tabsRef.current, newTab];
    setTabs(next);
    tabsRef.current = next;
    setActiveTabId(newTab.id);
    activeTabIdRef.current = newTab.id;
  };

  const handleCloseTab = (id: string) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  // sends every tab that has a url and reports how the assertions did. a single
  // agent run already exercises a whole flow, this is how you repeat it later
  // without asking the agent again.
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);
  const [runSummary, setRunSummary] = useState<{
    passed: number;
    failed: number;
    errors: number;
    sent: number;
  } | null>(null);

  const handleRunAll = async () => {
    const runnable = tabs.filter((t) => t.url.trim());
    if (runnable.length === 0 || runProgress) return;

    const vars = toMap(variables);
    setRunSummary(null);
    setRunProgress({ done: 0, total: runnable.length });

    let passed = 0;
    let failed = 0;
    let errors = 0;
    let sentCount = 0;

    // one at a time, so a dev server is not hit with the whole workspace at once
    for (let i = 0; i < runnable.length; i++) {
      const tab = runnable[i];
      try {
        let parsedBody = undefined;
        if (["POST", "PUT", "PATCH"].includes(tab.method) && tab.body.trim()) {
          parsedBody = JSON.parse(substitute(tab.body, vars));
        }

        const headerObj: Record<string, string> = {};
        tab.headers
          .filter((h) => h.enabled && h.key.trim())
          .forEach((h) => {
            headerObj[h.key] = substitute(h.value, vars);
          });

        const res = await sendRequest(
          tab.method,
          withScheme(applyPathParams(substitute(tab.url, vars), tab.pathParams || {}, vars)),
          headerObj,
          parsedBody
        );
        setTimings((prev) => recordTiming(prev, tab.method, tab.url, res));
        keepExample(tab.method, tab.url, tab.body, headerObj, res);

        // straight into the map this loop is resolving against, not only into
        // state. The whole point of a run is that the login at the top of it
        // gives the nine requests below it their token, and a setState landing
        // after the loop has moved on would have given it to none of them.
        const captured = applyCaptures(tab, res);
        Object.assign(vars, captured);

        const tested = runAssertions(tab.tests, res);
        tested.forEach((t) => (t.passed ? passed++ : failed++));

        sentCount++;
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  response: res,
                  tests: tested,
                  loading: false,
                  captures: withResults(
                    t.captures || [],
                    Object.entries(captured).map(([name, value]) => ({ name, value }))
                  ),
                }
              : t
          )
        );
      } catch {
        // a tab with an unparseable body or an unreachable host should not stop
        // the rest of the run
        errors++;
      }
      setRunProgress({ done: i + 1, total: runnable.length });
    }

    setRunProgress(null);
    setRunSummary({ passed, failed, errors, sent: sentCount });
    // the result sits on the run button, so it has to hand the button back
    // eventually or there is no visible way to run again
    setTimeout(() => setRunSummary(null), 8000);
  };

  // an agent run leaves a tab per request, and they persist. this is the way
  // back to a clean row without also throwing away the scan, which Reset does.
  const handleCloseOthers = () => {
    setTabs((prev) => prev.filter((t) => t.id === activeTabId));
  };

  // One tab per endpoint, wherever the endpoint is opened from.
  //
  // Every place that opened one used to add another: the sidebar, the recent
  // list, an applied run. Ten endpoints and a few visits back to them left a
  // row of tabs nobody could read, and the one holding the response you wanted
  // was somewhere in the middle. An endpoint you have already opened is
  // somewhere to return to.
  const focusOrOpenTab = (method: string, url: string, label?: string) => {
    const open = tabsRef.current.find((t) => t.method === method && t.url === url);
    if (open) {
      setActiveTabId(open.id);
      activeTabIdRef.current = open.id;
      return;
    }

    const tab = createTab(baseUrl);
    tab.method = method;
    tab.url = url;
    tab.label = label || `${method} ${url.replace(/^https?:\/\/[^/]+/, "")}`;

    const next = [...tabsRef.current, tab];
    setTabs(next);
    tabsRef.current = next;
    setActiveTabId(tab.id);
    activeTabIdRef.current = tab.id;
  };

  const handleReplayHistory = (entry: HistoryEntry) =>
    focusOrOpenTab(entry.method, entry.url);

  const handleReset = async () => {
    await clearWorkspace();
    const fresh = createTab(CONFIG.DEFAULT_TARGET);
    setRoutes([]);
    setTabs([fresh]);
    setActiveTabId(fresh.id);
    setHistory([]);
    setVariables([]);
    setTimings({});
    setRecentScans([]);
    setExamples({});
    // reset returns the app to a first launch, and a first launch has the
    // house rules on — not to an emptier state than the app ships with
    setInstructions(defaultInstructions());
    setInstructionsSent(null);
    setProjectName("ReqFlow");
    setProjectPath("");
    setGeneratedCode({});
    setActiveCodeKey(null);
    setGeneratedRoutes([]);
    setApplyPlan(null);
    setAppliedSummaries({});
    // now that runs outlive the session, reset has to take them with it — a
    // reset that leaves the Applied list behind has not reset anything the
    // developer can see
    setRuns([]);
    setApplyError(null);
    setBaseUrl(CONFIG.DEFAULT_TARGET);
    setError(null);
  };

  const handleNewTab = () => {
    const newTab = createTab(baseUrl);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  // the agent drafts a request, it does not send it. the tab opens filled in
  // and waits for the user to press Send like any other.
  const handleAgentCreateRequest = (draft: AgentRequestDraft) => {
    const newTab = createTab(baseUrl);
    const drafted = Object.entries(draft.headers || {}).map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }));

    // keep the default Content-Type unless the agent set its own
    const hasContentType = drafted.some((h) => h.key.toLowerCase() === "content-type");
    const headers = hasContentType
      ? drafted
      : [...newTab.headers.filter((h) => h.key === "Content-Type"), ...drafted];

    // Regenerating the same endpoint refreshes its tab rather than stacking a
    // second one. Three attempts at POST /api/users left three identical tabs
    // and the developer picking between them — and only the last one matched
    // the code on screen. The same rule the agent's own sends already follow.
    const existing = tabsRef.current.find(
      (t) => t.method === draft.method && t.url === draft.url
    );

    if (existing) {
      const next = tabsRef.current.map((t) =>
        t.id === existing.id
          ? { ...t, body: draft.body, headers, label: draft.label, response: null, tests: [] }
          : t
      );
      setTabs(next);
      tabsRef.current = next;
      setActiveTabId(existing.id);
      activeTabIdRef.current = existing.id;

      setGeneratedRoutes((prev) =>
        addGenerated(prev, toGeneratedRoute(draft, existing.id), routes)
      );
      return;
    }

    const next = [
      ...tabsRef.current,
      { ...newTab, method: draft.method, url: draft.url, body: draft.body, headers, label: draft.label },
    ];
    setTabs(next);
    tabsRef.current = next;
    setActiveTabId(newTab.id);
    activeTabIdRef.current = newTab.id;

    // and it goes in the sidebar, so the endpoint has somewhere to live once
    // this tab is no longer the one in front of the user. Only when the scan
    // does not already have it: the agent opens tabs for endpoints that exist
    // too, and listing those as missing would be a lie about their own code.
    setGeneratedRoutes((prev) =>
      addGenerated(prev, toGeneratedRoute(draft, newTab.id), routes)
    );
  };

  // Back to the request the agent already opened for this endpoint, rather than
  // a second tab drafting the same thing. If that tab has been closed since,
  // the row reopens it — a click that does nothing at all is worse than one
  // that brings the request back.
  // A row the agent wrote code for opens that code, because the code is the
  // thing that row is about: the tab beside it is one button away inside the
  // panel. Rows for endpoints the agent only drafted a request against have no
  // code behind them, and those still go straight to their tab — opening an
  // empty panel would be a worse answer than the one that was there before.
  const handleSelectGenerated = (route: GeneratedRoute) => {
    const key = routeKey(route.method, route.path);
    if (generatedCode[key]) {
      setActiveCodeKey(key);
      setShowCode(true);
      return;
    }

    const existing = tabsRef.current.find((t) => t.id === route.tabId);
    if (existing) {
      setActiveTabId(existing.id);
      activeTabIdRef.current = existing.id;
      return;
    }

    const tab = createTab(baseUrl);
    tab.method = route.method;
    tab.url = route.url;
    tab.label = route.label;

    const next = [...tabsRef.current, tab];
    setTabs(next);
    tabsRef.current = next;
    setActiveTabId(tab.id);
    activeTabIdRef.current = tab.id;

    // the row now points at the tab it just reopened
    setGeneratedRoutes((prev) =>
      prev.map((g) => (g.tabId === route.tabId ? { ...g, tabId: tab.id } : g))
    );
  };

  // the suggestions go, the tabs stay: the requests in them may have been
  // edited and sent, and closing those is a separate decision
  const handleClearGenerated = () => setGeneratedRoutes([]);

  // whatever the agent sent lands in the workspace on its own, with the real
  // response already attached. re-running the request here instead would show
  // the same thing twice and, for a write, would do it twice.
  const handleAgentRequests = (sent: AgentSentRequest[]) => {
    if (sent.length === 0) return;

    // the agent's requests are real sends too, so they belong in the baseline
    setTimings((prev) =>
      sent.reduce((acc, s) => recordTiming(acc, s.method, s.url, s.response), prev)
    );
    setExamples((prev) =>
      sent.reduce(
        (acc, s) =>
          recordExample(
            acc,
            toExample(
              { method: s.method, url: s.url, body: s.body },
              s.headers || {},
              s.response,
              Date.now()
            ),
            exampleLimit
          ),
        prev
      )
    );
    // built here rather than inside a setTabs updater: React is free to defer
    // an updater until render, and the id to select was being read on the next
    // line. it happened to work, but only while nothing else was queued.
    let focusId = activeTabIdRef.current;
    const next = [...tabsRef.current];

    for (const s of sent) {
      const headers = Object.entries(s.headers || {}).map(([key, value]) => ({
        key,
        value: String(value),
        enabled: true,
      }));
      // the agent leaves this to the http client, but a tab is re-sent by
      // hand, so spell it out or the resend goes without a content type
      if (s.body && !headers.some((h) => h.key.toLowerCase() === "content-type")) {
        headers.unshift({ key: "Content-Type", value: "application/json", enabled: true });
      }
      // testing the same endpoint again should refresh its tab, not stack one
      let at = next.findIndex((t) => t.method === s.method && t.url === s.url);

      // The tab the agent drafted holds /api/incidents/:id/commander while the
      // request that just ran names a real record. They are the same endpoint,
      // and the drafted tab is where the developer is looking — so the response
      // goes there, with the value ReqFlow used filled into Params so the tab
      // can be sent again by hand.
      let filledParams: Record<string, string> = {};
      if (at < 0) {
        at = next.findIndex((t) => {
          if (t.method !== s.method) return false;
          const values = matchTemplate(t.url, s.url);
          if (!values) return false;
          filledParams = values;
          return true;
        });
      }

      if (at >= 0) {
        next[at] = {
          ...next[at],
          headers,
          body: s.body,
          response: s.response,
          loading: false,
          pathParams: { ...(next[at].pathParams || {}), ...filledParams },
        };
        focusId = next[at].id;
      } else {
        const tab = createTab(baseUrl);
        tab.method = s.method;
        tab.url = s.url;
        tab.body = s.body;
        tab.headers = headers;
        tab.response = s.response;
        tab.label = `${s.method} ${s.url.replace(/^https?:\/\/[^/]+/, "")}`;
        next.push(tab);
        focusId = tab.id;
      }
    }

    setTabs(next);
    tabsRef.current = next;

    // the last request is the one the user asked about, so land them on it
    setActiveTabId(focusId);
    activeTabIdRef.current = focusId;
  };

  // the agent saves a token here after a login, so every tab can use {{token}}
  // instead of each one carrying its own copy
  // a run opens more tabs than the bar can show at once, so the log doubles as
  // the index into them
  const handleFocusRequest = (method: string, url: string) => {
    const tab = tabs.find((t) => t.method === method && t.url === url);
    if (!tab) return;
    setActiveTabId(tab.id);
    activeTabIdRef.current = tab.id;
  };

  // The agent noticed a standing preference. It arrives as text rather than as
  // a whole record so the app decides the id, and the duplicate check runs here
  // too: the backend's copy of the list is whatever was last sent, and a rule
  // added twice in one turn would otherwise slip past it.
  const handleRememberInstruction = (text: string) => {
    setInstructions((prev) => {
      const clean = text.trim().replace(/\s+/g, " ");
      if (!clean) return prev;
      if (prev.some((i) => i.text.toLowerCase() === clean.toLowerCase())) return prev;
      return [
        ...prev,
        {
          id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
          text: clean,
          enabled: true,
          at: Date.now(),
          source: "agent",
        },
      ];
    });
  };

  const handleAgentSetVariable = (name: string, value: string) => {
    setVariables((prev) => {
      const at = prev.findIndex((v) => v.key === name);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { key: name, value };
        return next;
      }
      return [...prev, { key: name, value }];
    });
  };

  // an endpoint the project does not have yet. the code is shown, and a tab is
  // drafted against it by the same reply, so the two arrive together.
  const handleGeneratedCode = (next: GeneratedEndpoint) => {
    const key = routeKey(next.method, next.path);
    // regenerating the same endpoint replaces its code, and its "applied" note
    // with it: the summary described the code that has just been thrown away
    setGeneratedCode((prev) => ({ ...prev, [key]: next }));
    setAppliedSummaries((prev) => {
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });
    setActiveCodeKey(key);
    setShowCode(true);
    setApplyPlan(null);
    setApplyError(null);
  };

  // from the code view to the request it drafted. the tab is already there,
  // opened by the create_request that rode along with the generation.
  const handleOpenGeneratedRequest = () => {
    setShowCode(false);
    if (!generated) return;
    const url = `${baseUrl.replace(/\/+$/, "")}${generated.path}`;
    const tab = tabs.find((t) => t.method === generated.method && t.url === url);
    if (tab) setActiveTabId(tab.id);
  };

  // The diff, built fresh from the folder as it is now. Opening the panel is
  // what fetches it, so a preview can never be a stale description of a write
  // that would do something else.
  const handlePreviewApply = async () => {
    if (!generated) return;
    if (!stylePath) {
      setError("No project folder is known, so there is nowhere to write. Scan a project first.");
      return;
    }

    setShowApply(true);
    setApplyPlan(null);
    setApplyError(null);
    setApplyLoading(true);

    try {
      setApplyPlan(await planGenerated(stylePath, generated.layers));
    } catch (err: any) {
      setApplyError(
        err?.response?.data?.error || err?.message || "the project folder could not be read"
      );
    } finally {
      setApplyLoading(false);
    }
  };

  // Write the code, then prove it: run the endpoint and read the result back,
  // so nobody does those two by hand to find out whether the generation worked.
  // Both land in tabs with their real responses, the same way an agent run does.
  const handleApply = async () => {
    if (!generated || !stylePath) return;

    // captured now: the panel can be pointed at another endpoint while the
    // write and the run are still going, and the summary belongs to this one
    const key = routeKey(generated.method, generated.path);
    const noteApplied = (outcome: ApplyOutcome) =>
      setAppliedSummaries((prev) => ({ ...prev, [key]: outcome }));

    setApplying(true);

    // the write and the run that follows it fail differently, and they are kept
    // apart because of what a shared catch would have to say: a verification
    // that threw would report "nothing was written" over files that had just
    // been changed, which is the worst thing this screen could tell anyone
    let written: string;
    let writtenFiles: AppliedFile[] = [];
    try {
      const applied = await applyGenerated(stylePath, generated.layers);
      writtenFiles = applied;
      setAppliedDetail((prev) => ({ ...prev, [key]: { files: applied, result: null } }));
      written = `${applied.length} file${applied.length === 1 ? "" : "s"} written`;
    } catch (err: any) {
      const detail =
        err?.response?.data?.error || err?.message || "the code could not be written";
      // a refusal the developer can undo by choosing the folder, rather than by
      // going to look for a system setting
      setApplyError({
        message: detail,
        // a refusal the developer can undo by choosing the folder, rather than
        // by going to look for a system setting
        recoverable: err?.response?.data?.code === "ACCESS_DENIED",
      });
      setApplying(false);
      return;
    }

    setShowApply(false);

    // Named rather than generic. Whether the next twenty seconds are a server
    // starting from cold, ReqFlow restarting its own, or a wait on one the
    // developer is running is the difference between patience and confusion —
    // and the app already knows which it is about to be.
    const owns = !!runningProject && runningProject.projectPath === stylePath;
    const about = owns
      ? "Restarting your server…"
      : targetUp
      ? "Waiting for your server to pick it up…"
      : "Starting your server…";
    noteApplied({ verdict: "unverified", text: `${written}. ${about}` });

    // the wait is the long part and the part worth being able to stop. the files
    // are already written by now and stay written, whatever happens next.
    const runId = `${Date.now()}${Math.random().toString(36).slice(2)}`;
    setVerifyingRun(runId);

    try {
      // the wire gets the resolved values, the tab keeps the {{name}} it was
      // written with, exactly as a hand-sent request does
      const vars = toMap(variables);
      const writtenHeaders = generated.request.headers || {};
      const resolved: Record<string, string> = {};
      Object.entries(writtenHeaders).forEach(([k, v]) => {
        resolved[k] = substitute(String(v), vars);
      });

      const result = await verifyGenerated({
        baseUrl,
        method: generated.method,
        path: generated.path,
        headers: resolved,
        body: generated.request.body ?? null,
        verify: generated.verify,
        // whether the server was answering a moment ago, which is what turns
        // "nothing answered" into "what you just applied stopped it"
        serverWasUp: targetUp === true,
        runId,
        // ReqFlow reloads the project itself when it is the one running it, and
        // starts it when nothing is. A server the developer started in their own
        // terminal is left alone.
        projectPath: stylePath,
        fallbackAuth: workspaceAuth(tabsRef.current, vars),
      });

      const bodyText =
        generated.request.body === null ? "" : JSON.stringify(generated.request.body, null, 2);

      const sent: AgentSentRequest[] = [];
      if (result.create) {
        sent.push({ ...result.create, headers: writtenHeaders, body: bodyText });
      }
      if (result.read) {
        sent.push({ ...result.read, headers: writtenHeaders, body: "" });
      }
      if (sent.length > 0) handleAgentRequests(sent);

      // The tab the agent drafted still holds the literal :id, so pressing Send
      // on it does nothing useful — while ReqFlow has just run this endpoint
      // against a real record and knows which one. Filling it in turns a tab
      // that cannot be sent into one that can, using a value the developer can
      // see and change rather than one hidden inside the run.
      if (result.usedRecordId) {
        const param = (generated.path.match(/:([A-Za-z_][\w]*)/) || [])[1];
        const draftUrl = `${baseUrl.replace(/\/+$/, "")}${generated.path}`;
        if (param) {
          const next = tabsRef.current.map((t) =>
            t.method === generated.method && t.url === draftUrl
              ? { ...t, pathParams: { ...(t.pathParams || {}), [param]: result.usedRecordId! } }
              : t
          );
          setTabs(next);
          tabsRef.current = next;
        }
      }

      const outcome = describeApplied(written, result);
      noteApplied(outcome);
      setAppliedDetail((prev) => ({ ...prev, [key]: { files: writtenFiles, result } }));

      // kept as one row of recent work, with the breakdown the backend measured
      setRuns((prev) =>
        [
          {
            id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
            at: Date.now(),
            method: generated.method,
            path: generated.path,
            verdict: outcome.verdict,
            text: outcome.text,
            phases: result.phases || [],
          },
          ...prev,
        ].slice(0, 4)
      );

      // ReqFlow may have started or restarted the project to run this, and the
      // status bar should say so without waiting for the next tick
      refreshRunning();
      setRecheckTarget((n) => n + 1);

      // The panel stays open, on success as much as on failure. It used to close
      // itself when a change verified, on the reasoning that good news needs no
      // dwelling on — which made the one thing this product claims the one thing
      // that flashed past. What was checked is the argument; it stays on screen
      // until the developer closes it.

      // the Generated group is for endpoints the server does not serve yet, and
      // this one now answers. a server that never restarted still does not, so
      // the row stays until it does.
      if (result.pickedUp) {
        setGeneratedRoutes((prev) =>
          prev.filter((g) => !(g.method === generated.method && g.path === generated.path))
        );
      }
    } catch (err: any) {
      // the files did change, and the check did not run. that is "we cannot
      // tell", not "it failed" — and not "it worked" either.
      const detail = err?.response?.data?.error || err?.message || "unknown error";
      noteApplied({
        verdict: "unverified",
        text: `${written}, but it could not be checked: ${detail}`,
      });
    } finally {
      setApplying(false);
      setVerifyingRun(null);
    }
  };

  // Stops the checking, not the change: the files are already written and are
  // left exactly as they are. Saying otherwise would be wrong twice over.
  const handleCancelVerify = async () => {
    if (!verifyingRun) return;
    await cancelRun("generate", verifyingRun);
  };

  const handleAgentCreateAssertions = (assertions: AgentAssertion[]) => {
    const withIds = assertions.map((a, i) => ({
      id: `${Date.now()}${i}${Math.random().toString(36).slice(2)}`,
      field: a.field,
      operator: a.operator,
      value: a.value,
      passed: null,
    }));
    // the ref, not activeTabId, because one reply can draft a tab and then put
    // its tests in it before React has re-rendered with the new active id
    const targetId = activeTabIdRef.current;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== targetId) return t;
        const tests = [...t.tests, ...withIds];
        // when there is already a response to judge, judge it. leaving fresh
        // assertions blank next to a visible response reads as broken, and
        // makes the user hunt for Re-run to learn something we already know.
        return { ...t, tests: t.response ? runAssertions(tests, t.response) : tests };
      })
    );
  };

  const handleSend = async () => {
    if (!activeTab.url.trim()) return;
    updateActiveTab({ loading: true, response: null });

    try {
      // {{name}} is resolved here rather than in the editors, so what the tab
      // shows stays the reusable version and only the wire sees real values
      const vars = toMap(variables);

      let parsedBody = undefined;
      if (["POST", "PUT", "PATCH"].includes(activeTab.method) && activeTab.body.trim()) {
        parsedBody = JSON.parse(substitute(activeTab.body, vars));
      }

      const headerObj: Record<string, string> = {};
      activeTab.headers
        .filter((h) => h.enabled && h.key.trim())
        .forEach((h) => {
          headerObj[h.key] = substitute(h.value, vars);
        });

      const res = await sendRequest(
        activeTab.method,
        withScheme(applyPathParams(substitute(activeTab.url, vars), activeTab.pathParams || {}, vars)),
        headerObj,
        parsedBody
      );

      // recorded before the tab updates, so the comparison shown alongside the
      // new response is against the runs that came before it
      setTimings((prev) => recordTiming(prev, activeTab.method, activeTab.url, res));
      // the tab's own text, not the resolved values: an example holding a raw
      // token would be the thing redaction exists to prevent, and {{token}} is
      // what makes the request reusable later anyway
      keepExample(activeTab.method, activeTab.url, activeTab.body, headerObj, res);

      // assertions run on their own after every send. having to remember a
      // second button was the only way to ever see a result before.
      const captured = applyCaptures(activeTab, res);

      updateActiveTab({
        response: res,
        loading: false,
        tests: runAssertions(activeTab.tests, res),
        captures: withResults(activeTab.captures || [], Object.entries(captured).map(([name, value]) => ({ name, value }))),
      });

      setHistory((prev) =>
        [
          {
            id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
            method: activeTab.method,
            url: activeTab.url,
            status: res.status,
            timing: res.timing.total,
            at: Date.now(),
          },
          ...prev,
        ].slice(0, 10)
      );
    } catch (err: any) {
      const detail =
        err instanceof SyntaxError
          ? `Request body is not valid JSON: ${err.message}`
          : err?.response?.data?.error || err?.message || "unknown error";
      setError(detail);
      updateActiveTab({ loading: false });
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <TopBar
        projectName={projectName}
        routeCount={routes.length}
        target={target}
        targetUp={targetUp}
        instructionCount={activeInstructions.length}
        onOpenInstructions={() => setShowInstructions(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <View style={styles.main}>
        <Sidebar
          routes={routes}
          onSelectRoute={handleSelectRoute}
          onShowSource={handleShowSource}
          onScanPress={() => {
            setError(null);
            setShowScan(true);
          }}
          scanning={scanning}
          baseUrl={baseUrl}
          onBaseUrlChange={setBaseUrl}
          history={history}
          onSelectHistory={handleReplayHistory}
          onReset={handleReset}
          variables={variables}
          onVariablesChange={setVariables}
          onExportOpenApi={() => exportOpenApi(routes, projectName, baseUrl)}
          generatedRoutes={generatedRoutes}
          onSelectGenerated={handleSelectGenerated}
          onClearGenerated={handleClearGenerated}
          generatedWithCode={generatedCodeKeys}
          runs={runs}
          onSelectRun={(run) => {
            // Opens the code straight away when it is still on hand, because
            // that panel carries the evidence as well as the verdict. Otherwise
            // the run's own record, which was raised as an error toast before —
            // one line, in the colour used for failures, for runs that worked.
            const key = routeKey(run.method, run.path);
            if (generatedCode[key]) {
              setActiveCodeKey(key);
              setShowCode(true);
              return;
            }
            setOpenRun(run);
          }}
        />

        <View style={styles.center}>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
            onCloseOthers={handleCloseOthers}
            onRunAll={handleRunAll}
            runProgress={runProgress}
            runSummary={runSummary}
          />

          <RequestBuilder
            method={activeTab.method}
            url={activeTab.url}
            body={activeTab.body}
            headers={activeTab.headers}
            tests={activeTab.tests}
            captures={activeTab.captures || []}
            onCapturesChange={(captures) => updateActiveTab({ captures })}
            onMethodChange={(m) => updateActiveTab({ method: m, label: `${m} ${activeTab.url}` })}
            onUrlChange={(u) => updateActiveTab({ url: u })}
            onBodyChange={(b) => updateActiveTab({ body: b })}
            onHeadersChange={(h) => updateActiveTab({ headers: h })}
            onTestsChange={(t) => updateActiveTab({ tests: t })}
            onSend={handleSend}
            loading={activeTab.loading}
            response={activeTab.response}
            timingNote={timingReport.summary}
            routeCount={routes.length}
            pathParams={activeTab.pathParams || {}}
            onPathParamsChange={(v) => updateActiveTab({ pathParams: v })}
            onSaveToken={(value) => handleAgentSetVariable("token", value)}
            savedToken={toMap(variables).token || null}
            variables={toMap(variables)}
            onScanPress={() => {
              setError(null);
              setShowScan(true);
            }}
            exampleCount={activeExamples.length}
            onOpenExamples={() => setShowExamples(true)}
          />

          <RuntimeTrace
            response={activeTab.response}
            method={activeTab.method}
            // the trace describes a request that happened, so it shows the
            // address that was actually used rather than the :id placeholder
            url={applyPathParams(
              substitute(activeTab.url, toMap(variables)),
              activeTab.pathParams || {}
            )}
            comparisons={timingReport.comparisons}
          />
        </View>

        <AiAgent
          routes={routes}
          onSelectRoute={handleSelectRoute}
          visible={showAiAgent}
          onClose={() => setShowAiAgent(false)}
          baseUrl={baseUrl}
          activeTab={activeTabContext}
          onCreateRequest={handleAgentCreateRequest}
          onCreateAssertions={handleAgentCreateAssertions}
          onAgentRequests={handleAgentRequests}
          onSetVariable={handleAgentSetVariable}
          onFocusRequest={handleFocusRequest}
          variables={toMap(variables)}
          projectPath={stylePath}
          onGeneratedCode={handleGeneratedCode}
          onShowCode={() => generated && setShowCode(true)}
          instructions={activeInstructions}
          onRememberInstruction={handleRememberInstruction}
          onInstructionsSent={setInstructionsSent}
        />
      </View>

      {/* the scan modal renders above the toast layer, so scan errors
          are shown inside it instead */}
      <AppStatusBar
        workspace={projectName === "ReqFlow" ? "No project open" : `${projectName} workspace`}
        requestCount={history.length}
        model={model}
        runningProject={runningProject}
        onStopProject={handleStopProject}
      />

      <Toast message={showScan ? null : error} onDismiss={() => setError(null)} />

      <RunDetail
        run={openRun}
        onClose={() => setOpenRun(null)}
        onOpenCode={
          openRun && generatedCode[routeKey(openRun.method, openRun.path)]
            ? () => {
                setActiveCodeKey(routeKey(openRun.method, openRun.path));
                setShowCode(true);
                setOpenRun(null);
              }
            : null
        }
        onOpenRequest={() => {
          if (!openRun) return;
          const tab = createTab(baseUrl);
          tab.method = openRun.method;
          tab.url = `${baseUrl.replace(/\/+$/, "")}${openRun.path}`;
          tab.label = openRun.path;
          const next = [...tabsRef.current, tab];
          setTabs(next);
          tabsRef.current = next;
          setActiveTabId(tab.id);
          setOpenRun(null);
        }}
      />

      {/* The preview is a step inside this flow rather than a separate window,
          so the code view steps back while the diff is being read. Both on
          screen at once put the code view on top of the Apply button, which
          made it unclickable — the panel looked open and did nothing. */}
      <CodeView
        source={routeSource ? { file: routeSource.file, line: routeSource.line } : null}
        // everything the agent has written code for this session, so a turn that
        // produced two endpoints does not hide one of them
        pending={routeSource ? [] : Object.entries(generatedCode).map(([key, g]) => ({
          key,
          method: g.method,
          path: g.path,
          applied: !!appliedSummaries[key],
        }))}
        activeKey={activeCodeKey}
        onSelectPending={(key) => {
          setActiveCodeKey(key);
          setApplyPlan(null);
          setApplyError(null);
        }}
        visible={showCode && !showApply}
        // one panel, two sources: the agent's code, or the project's own read
        // off disk. The shape is the same because the question is the same.
        generated={
          routeSource
            ? {
                method: routeSource.method,
                path: routeSource.path,
                summary: "",
                layers: [{ layer: "source", path: routeSource.file, code: routeSource.code }],
                request: { headers: {}, body: null },
                notes: [],
                references: [],
                verify: null,
              }
            : generated
        }
        onClose={() => {
          setShowCode(false);
          setRouteSource(null);
        }}
        onOpenRequest={
          routeSource
            ? () => {
                const route = routes.find(
                  (r) => r.method === routeSource.method && r.path === routeSource.path
                );
                setShowCode(false);
                setRouteSource(null);
                if (route) openRouteTab(route);
              }
            : handleOpenGeneratedRequest
        }
        onPreviewApply={handlePreviewApply}
        applied={appliedOutcome}
        evidence={appliedEvidence}
        onOpenExchange={handleFocusRequest}
        verifying={!!verifyingRun}
        onCancelVerify={handleCancelVerify}
      />

      {/* the request goes back into the tab; the response deliberately does
          not. a stored response in the viewer is indistinguishable from one
          that just came back, which is why they were not saved at all before */}
      <ExamplesPanel
        visible={showExamples}
        examples={activeExamples}
        limit={exampleLimit}
        onClose={() => setShowExamples(false)}
        onLimitChange={setExampleLimit}
        onRestore={(example) => {
          updateActiveTab({
            method: example.method,
            url: example.url,
            body: example.body,
            headers: Object.entries(example.headers).map(([key, value]) => ({
              key,
              value,
              enabled: true,
            })),
          });
          setShowExamples(false);
        }}
      />

      <SettingsPanel
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        model={model}
        onRecheckModel={() => {
          setModel(null);
          checkModel()
            .then(setModel)
            .catch(() => setModel(null));
        }}
        instructions={instructions}
        onOpenInstructions={() => {
          setShowSettings(false);
          setShowInstructions(true);
        }}
        exampleLimit={exampleLimit}
        onExampleLimitChange={setExampleLimit}
        exampleCount={activeExamples.length}
        onClearExamples={() => setExamples({})}
        projectPath={stylePath || ""}
        runningProject={runningProject}
        onStopProject={handleStopProject}
      />

      <InstructionPanel
        visible={showInstructions}
        instructions={instructions}
        onClose={() => setShowInstructions(false)}
        onChange={setInstructions}
        lastSent={instructionsSent}
      />

      <ApplyPreview
        visible={showApply}
        plan={applyPlan}
        loading={applyLoading}
        error={applyError?.message ?? null}
        onChooseFolder={
          applyError?.recoverable &&
          typeof (globalThis as any).reqflowDesktop?.chooseProjectFolder === "function"
            ? regrantAndRetry
            : null
        }
        applying={applying}
        onCancel={() => setShowApply(false)}
        onApply={handleApply}
      />

      <ScanModal
        visible={showScan}
        onClose={() => setShowScan(false)}
        onScan={handleScan}
        scanning={scanning}
        error={error}
        recent={recentScans}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    // Room for the phone's own status bar, and only there. The 44 was an iOS
    // notch inset that web and the desktop window inherited too, so every
    // launch opened with an empty black band above the header — the first thing
    // anyone saw, and the one part of the screen that showed nothing.
    paddingTop:
      Platform.OS === "android"
        ? StatusBar.currentHeight
        : Platform.OS === "ios"
        ? 44
        : 0,
  },
  main: {
    flex: 1,
    flexDirection: "row",
  },
  center: {
    flex: 1,
  },
});
