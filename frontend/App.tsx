import React, { useState } from "react";
import { View, StyleSheet, StatusBar, Platform } from "react-native";
import Sidebar from "./src/components/Sidebar";
import TopBar from "./src/components/TopBar";
import AiAgent from "./src/components/AiAgent";
import TabBar from "./src/components/TabBar";
import RequestBuilder from "./src/components/RequestBuilder";
import RuntimeTrace from "./src/components/RuntimeTrace";
import ScanModal from "./src/components/ScanModal";
import Toast from "./src/components/Toast";
import AppStatusBar from "./src/components/StatusBar";
import { analyzeProject, sendRequest, checkTarget } from "./src/services/api";
import { DetectedRoute, RequestTab, HistoryEntry } from "./src/types";
import { colors } from "./src/theme/colors";
import { CONFIG } from "./src/config";
import { runAssertions } from "./src/lib/assertions";
import { loadWorkspace, saveWorkspace } from "./src/lib/persist";

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
      });
    }, 400);
    return () => clearTimeout(id);
  }, [hydrated, baseUrl, projectName, routes, tabs, activeTabId, history]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // the server the active request points at, if the url parses
  const target = React.useMemo(() => {
    try {
      return new URL(activeTab.url).origin;
    } catch {
      return null;
    }
  }, [activeTab.url]);

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

  const handleScan = async (projectPath: string) => {
    setScanning(true);
    try {
      const result = await analyzeProject(projectPath);
      setRoutes(result.routes);
      setProjectName(projectPath.split("/").pop() || "Project");
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

  const handleReplayHistory = (entry: HistoryEntry) => {
    const tab = createTab(baseUrl);
    tab.method = entry.method;
    tab.url = entry.url;
    tab.label = `${entry.method} ${entry.url.replace(/^https?:\/\/[^/]+/, "")}`;
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const handleNewTab = () => {
    const newTab = createTab(baseUrl);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleSend = async () => {
    if (!activeTab.url.trim()) return;
    updateActiveTab({ loading: true, response: null });

    try {
      let parsedBody = undefined;
      if (["POST", "PUT", "PATCH"].includes(activeTab.method) && activeTab.body.trim()) {
        parsedBody = JSON.parse(activeTab.body);
      }

      const headerObj: Record<string, string> = {};
      activeTab.headers
        .filter((h) => h.enabled && h.key.trim())
        .forEach((h) => {
          headerObj[h.key] = h.value;
        });

      const res = await sendRequest(activeTab.method, activeTab.url, headerObj, parsedBody);

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
        />

        <View style={styles.center}>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
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
          />

          <RuntimeTrace
            response={activeTab.response}
            method={activeTab.method}
            url={activeTab.url}
          />
        </View>

        <AiAgent
          routes={routes}
          onSelectRoute={handleSelectRoute}
          visible={showAiAgent}
          onClose={() => setShowAiAgent(false)}
          baseUrl={baseUrl}
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
