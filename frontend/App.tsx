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
import Toast from "./src/components/Toast";
import AppStatusBar from "./src/components/StatusBar";
import {
  analyzeProject,
  sendRequest,
  checkTarget,
  exportOpenApi,
} from "./src/services/api";
import { DetectedRoute, RequestTab, HistoryEntry } from "./src/types";
import { colors } from "./src/theme/colors";
import { CONFIG } from "./src/config";
import { runAssertions } from "./src/lib/assertions";
import { loadWorkspace, saveWorkspace, clearWorkspace } from "./src/lib/persist";
import { Variable, toMap, substitute } from "./src/lib/variables";
import { withScheme, originOf } from "./src/lib/url";
import { applyPathParams } from "./src/lib/pathParams";
import {
  TimingHistory,
  record as recordTiming,
  compare as compareTimings,
  summarise as summariseTiming,
  endpointKey,
} from "./src/lib/timings";

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
      });
    }, 400);
    return () => clearTimeout(id);
  }, [hydrated, baseUrl, projectName, routes, tabs, activeTabId, history, variables, timings, recentScans]);

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
  }, [target]);

  const updateActiveTab = (updates: Partial<RequestTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, ...updates } : t))
    );
  };

  // the base url comes from the modal now: a scan that leaves it at a default
  // points every route it just found at whatever happens to run on port 3000
  const handleScan = async (projectPath: string, scannedBaseUrl: string) => {
    setScanning(true);
    try {
      const result = await analyzeProject(projectPath);
      setRoutes(result.routes);
      setProjectName(projectPath.split("/").pop() || "Project");
      setBaseUrl(withScheme(scannedBaseUrl));
      setRecentScans((prev) => [projectPath, ...prev.filter((p) => p !== projectPath)].slice(0, 4));
      setShowScan(false);
    } catch (err: any) {
      const detail = err?.response?.data?.error || err?.message || "unknown error";
      setError(`Scan failed: ${detail}`);
    } finally {
      setScanning(false);
    }
  };

  const handleSelectRoute = (route: DetectedRoute) => {
    const newTab = createTab(baseUrl, route);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
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
          withScheme(applyPathParams(substitute(tab.url, vars), tab.pathParams || {})),
          headerObj,
          parsedBody
        );
        setTimings((prev) => recordTiming(prev, tab.method, tab.url, res));
      const tested = runAssertions(tab.tests, res);
        tested.forEach((t) => (t.passed ? passed++ : failed++));

        sentCount++;
        setTabs((prev) =>
          prev.map((t) => (t.id === tab.id ? { ...t, response: res, tests: tested, loading: false } : t))
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

  const handleReplayHistory = (entry: HistoryEntry) => {
    const tab = createTab(baseUrl);
    tab.method = entry.method;
    tab.url = entry.url;
    tab.label = `${entry.method} ${entry.url.replace(/^https?:\/\/[^/]+/, "")}`;
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

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
    setProjectName("ReqFlow");
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

    setTabs((prev) => [
      ...prev,
      {
        ...newTab,
        method: draft.method,
        url: draft.url,
        body: draft.body,
        headers: hasContentType
          ? drafted
          : [...newTab.headers.filter((h) => h.key === "Content-Type"), ...drafted],
        label: draft.label,
      },
    ]);
    setActiveTabId(newTab.id);
    activeTabIdRef.current = newTab.id;
  };

  // whatever the agent sent lands in the workspace on its own, with the real
  // response already attached. re-running the request here instead would show
  // the same thing twice and, for a write, would do it twice.
  const handleAgentRequests = (sent: AgentSentRequest[]) => {
    if (sent.length === 0) return;

    // the agent's requests are real sends too, so they belong in the baseline
    setTimings((prev) =>
      sent.reduce((acc, s) => recordTiming(acc, s.method, s.url, s.response), prev)
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
      const at = next.findIndex((t) => t.method === s.method && t.url === s.url);

      if (at >= 0) {
        next[at] = { ...next[at], headers, body: s.body, response: s.response, loading: false };
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
        withScheme(applyPathParams(substitute(activeTab.url, vars), activeTab.pathParams || {})),
        headerObj,
        parsedBody
      );

      // recorded before the tab updates, so the comparison shown alongside the
      // new response is against the runs that came before it
      setTimings((prev) => recordTiming(prev, activeTab.method, activeTab.url, res));

      // assertions run on their own after every send. having to remember a
      // second button was the only way to ever see a result before.
      updateActiveTab({
        response: res,
        loading: false,
        tests: runAssertions(activeTab.tests, res),
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
      />

      <View style={styles.main}>
        <Sidebar
          routes={routes}
          onSelectRoute={handleSelectRoute}
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
            onScanPress={() => {
              setError(null);
              setShowScan(true);
            }}
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
        />
      </View>

      {/* the scan modal renders above the toast layer, so scan errors
          are shown inside it instead */}
      <AppStatusBar
        workspace={`${projectName} workspace`}
        target={target}
        targetUp={targetUp}
        requestCount={history.length}
      />

      <Toast message={showScan ? null : error} onDismiss={() => setError(null)} />

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
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 44,
  },
  main: {
    flex: 1,
    flexDirection: "row",
  },
  center: {
    flex: 1,
  },
});
