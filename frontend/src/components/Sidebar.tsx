import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import Icon from "./Icon";
import { DetectedRoute, HistoryEntry, GeneratedRoute, RunRecord } from "../types";
import { Variable, isSecretVariable } from "../lib/variables";
import { routeKey } from "../lib/generatedRoutes";
import { recentEndpoints } from "../lib/recent";
import * as Clipboard from "expo-clipboard";

// how many endpoints the sidebar keeps in view under Recent
const RECENT_SHOWN = 3;


interface Props {
  routes: DetectedRoute[];
  onSelectRoute: (route: DetectedRoute) => void;
  // the source behind an endpoint the project already has, opened from the row
  // rather than by clicking it: the row's job is to take you to the endpoint
  onShowSource: (route: DetectedRoute) => void;
  onScanPress: () => void;
  scanning: boolean;
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  history: HistoryEntry[];
  onSelectHistory: (entry: HistoryEntry) => void;
  onReset: () => void;
  variables: Variable[];
  onVariablesChange: (vars: Variable[]) => void;
  onExportOpenApi: () => Promise<string>;
  // endpoints the agent wrote that the project does not have yet
  generatedRoutes: GeneratedRoute[];
  onSelectGenerated: (route: GeneratedRoute) => void;
  onClearGenerated: () => void;
  // routeKey()s the agent wrote source for. those rows open the code; the rest
  // open their request tab, and two rows that behave differently should not
  // look identical.
  generatedWithCode: Set<string>;
  // the last few applies, so what happened stays readable after the panel that
  // reported it has been closed
  runs: RunRecord[];
  onSelectRun: (run: RunRecord) => void;
}

export default function Sidebar({
  routes,
  onSelectRoute,
  onShowSource,
  onScanPress,
  scanning,
  baseUrl,
  onBaseUrlChange,
  history,
  onSelectHistory,
  onReset,
  variables,
  onVariablesChange,
  onExportOpenApi,
  generatedRoutes,
  onSelectGenerated,
  onClearGenerated,
  generatedWithCode,
  runs,
  onSelectRun,
}: Props) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [showVars, setShowVars] = React.useState(false);
  const [specCopied, setSpecCopied] = React.useState<string | null>(null);

  const copySpec = async () => {
    try {
      await Clipboard.setStringAsync(await onExportOpenApi());
      setSpecCopied("Copied OpenAPI JSON");
    } catch (err: any) {
      setSpecCopied(err?.response?.data?.error || "Export failed");
    }
    setTimeout(() => setSpecCopied(null), 2200);
  };

  const matches = (method: string, path: string) => {
    const needle = search.toLowerCase();
    return path.toLowerCase().includes(needle) || method.toLowerCase().includes(needle);
  };

  const filtered = routes.filter((r) => matches(r.method, r.path));
  const filteredGenerated = generatedRoutes.filter((g) => matches(g.method, g.path));

  // group routes by first path segment
  const grouped: Record<string, DetectedRoute[]> = {};
  filtered.forEach((r) => {
    const segment = r.path.split("/")[1] || "other";
    if (!grouped[segment]) grouped[segment] = [];
    grouped[segment].push(r);
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {/* This said "API Explorer" while the header said "API Builder", so
              the app gave itself two names on one screen. The panel is a list of
              endpoints; naming it that leaves exactly one product name visible. */}
          <Text style={styles.title}>Endpoints</Text>
          <Pressable
            style={({ hovered: h }: any) => [styles.reset, h && styles.resetHover]}
            onPress={() => {
              if (confirmReset) {
                setConfirmReset(false);
                onReset();
              } else {
                setConfirmReset(true);
                // reverts on its own so the armed state is never a surprise later
                setTimeout(() => setConfirmReset(false), 4000);
              }
            }}
          >
            <Text style={[styles.resetText, confirmReset && styles.resetTextArmed]}>
              {confirmReset ? "Sure? Click again" : "Reset"}
            </Text>
          </Pressable>
        </View>
        <Pressable
          style={({ pressed }: any) => [
            styles.scanBtn,
            pressed && styles.scanBtnPressed,
          ]}
          onPress={onScanPress}
          disabled={scanning}
        >
          <Text style={styles.scanBtnText}>
            {scanning ? "Scanning..." : "Scan Project"}
          </Text>
        </Pressable>
      </View>

      {/* the server the scanned routes will be sent to. without this every
          route defaulted to ReqFlow's own backend and returned 404 */}
      <Text style={styles.fieldLabel}>Base URL</Text>
      <TextInput
        style={styles.baseUrl}
        placeholder="http://localhost:3000"
        placeholderTextColor={colors.textDim}
        value={baseUrl}
        onChangeText={onBaseUrlChange}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* {{name}} placeholders, resolved on every send. the agent writes the
          token in here after a login so each tab stops needing its own. */}
      <Pressable style={styles.varsHeader} onPress={() => setShowVars(!showVars)}>
        <Icon name={showVars ? "chevronDown" : "chevronRight"} size={12} color={colors.textDim} />
        <Text style={styles.fieldLabel}>Variables</Text>
        {variables.length > 0 && <Text style={styles.groupCount}>{variables.length}</Text>}
      </Pressable>

      {showVars && (
        <View style={styles.varsBox}>
          {variables.map((v, i) => (
            <View key={i} style={styles.varRow}>
              <TextInput
                style={[styles.varInput, styles.varKey]}
                placeholder="name"
                placeholderTextColor={colors.textDim}
                value={v.key}
                onChangeText={(key) =>
                  onVariablesChange(variables.map((x, j) => (j === i ? { ...x, key } : x)))
                }
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.varInput}
                placeholder="value"
                placeholderTextColor={colors.textDim}
                value={v.value}
                onChangeText={(value) =>
                  onVariablesChange(variables.map((x, j) => (j === i ? { ...x, value } : x)))
                }
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={isSecretVariable(v.key)}
              />
              <Pressable
                accessibilityLabel="remove this variable"
                style={styles.varRemove}
                onPress={() => onVariablesChange(variables.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={12} color={colors.textDim} />
              </Pressable>
            </View>
          ))}
          <Pressable
            style={({ hovered: h }: any) => [styles.varAdd, h && styles.varAddHover]}
            onPress={() => onVariablesChange([...variables, { key: "", value: "" }])}
          >
            <Text style={styles.varAddText}>+ Add variable</Text>
          </Pressable>
          <Text style={styles.varsHint}>use as {"{{name}}"} in a url, header or body</Text>
        </View>
      )}

      {routes.length > 0 && (
        <Pressable
          style={({ hovered: h }: any) => [styles.exportBtn, h && styles.exportBtnHover]}
          onPress={copySpec}
        >
          <Text style={styles.exportText}>{specCopied || "Copy as OpenAPI"}</Text>
        </Pressable>
      )}

      <TextInput
        style={styles.search}
        placeholder="Search endpoints"
        placeholderTextColor={colors.textDim}
        value={search}
        onChangeText={setSearch}
      />

      <ScrollView style={styles.list}>
        {Object.entries(grouped).map(([group, groupRoutes]) => (
          <View key={group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>
                /{group}
              </Text>
              <Text style={styles.groupCount}>{groupRoutes.length}</Text>
            </View>
            {groupRoutes.map((route, i) => {
              const key = `${route.method} ${route.path}`;
              const active = activePath === key;
              return (
                // lifted while its description is up, or the rows after it
                // paint over the floating box
                <View key={i} style={hovered === key ? styles.routeRowRaised : undefined}>
                  <Pressable
                    style={({ hovered: h, pressed }: any) => [
                      styles.routeItem,
                      active && styles.routeItemActive,
                      (h || pressed) && styles.routeItemHover,
                    ]}
                    onHoverIn={() => setHovered(key)}
                    onHoverOut={() => setHovered(null)}
                    onPress={() => {
                      setActivePath(key);
                      onSelectRoute(route);
                    }}
                  >
                    <Text
                      style={[
                        styles.method,
                        { color: (colors.method as any)[route.method] || colors.text },
                      ]}
                    >
                      {route.method}
                    </Text>
                    <Text
                      style={[styles.path, active && styles.pathActive]}
                      numberOfLines={1}
                    >
                      {route.path}
                    </Text>

                    {/* The code behind this endpoint, on its own control.
                        Clicking the row goes to the endpoint — that is what a
                        row in this list is for, and opening a panel instead put
                        a step between the developer and sending a request. */}
                    {hovered === key && (
                      <Pressable
                        onPress={(e: any) => {
                          e?.stopPropagation?.();
                          onShowSource(route);
                        }}
                        accessibilityLabel={`show the code for ${route.method} ${route.path}`}
                        style={({ hovered: h }: any) => [styles.codeBtn, h && styles.codeBtnHover]}
                      >
                        <Icon name="terminal" size={11} color={colors.textDim} />
                      </Pressable>
                    )}
                  </Pressable>

                  {/* hover only, so this never appears on a phone */}
                  {hovered === key && !!route.description && (
                    <View style={styles.tooltip}>
                      <Text style={styles.tooltipText}>{route.description}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        {/* Endpoints the agent wrote code for. They are kept out of the list
            above because the project does not serve them yet: shown among the
            scanned routes with nothing to tell them apart, they would read as
            endpoints that are already there. */}
        {filteredGenerated.length > 0 && (
          <View>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>Generated</Text>
              <View style={styles.generatedHeaderRight}>
                <Text style={styles.groupCount}>{filteredGenerated.length}</Text>
                <Pressable
                  accessibilityLabel="clear the generated list"
                  style={({ hovered: h }: any) => [styles.clearGenerated, h && styles.routeItemHover]}
                  onPress={onClearGenerated}
                >
                  <Icon name="close" size={11} color={colors.textDim} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.generatedNote}>not in the project yet</Text>

            {filteredGenerated.map((route) => (
              <Pressable
                key={`${route.method} ${route.path}`}
                style={({ hovered: h, pressed }: any) => [
                  styles.routeItem,
                  (h || pressed) && styles.routeItemHover,
                ]}
                onPress={() => onSelectGenerated(route)}
                accessibilityLabel={
                  generatedWithCode.has(routeKey(route.method, route.path))
                    ? `${route.method} ${route.path}, opens the code the agent wrote`
                    : `${route.method} ${route.path}, opens the request tab`
                }
              >
                {/* the method keeps its colour: it is still a GET or a POST,
                    and the row is dimmed by the path and the tag instead */}
                <Text
                  style={[
                    styles.method,
                    { color: (colors.method as any)[route.method] || colors.text },
                  ]}
                >
                  {route.method}
                </Text>
                <Text style={[styles.path, styles.generatedPath]} numberOfLines={1}>
                  {route.path}
                </Text>
                {/* the same mark the agent panel carries, rather than the word
                    "generated" spelled out: at this width the tag took enough
                    of the row to cut the path down to "/api/incide…", and the
                    path is the part being read.
                    A row with source behind it opens that source instead of a
                    tab, so it is marked: same icon, undimmed, which is as much
                    difference as this width has room for. */}
                <View style={styles.generatedTag}>
                  <Icon
                    name="sparkle"
                    size={10}
                    color={
                      generatedWithCode.has(routeKey(route.method, route.path))
                        ? colors.textMuted
                        : colors.textDim
                    }
                  />
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* What ReqFlow did to the project, and whether it worked. The code
            view says this once and then closes; this is where it stays. Four,
            because the fifth one back has never been the one anybody wanted. */}
        {runs.length > 0 && (
          <View>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>Applied</Text>
              <Text style={styles.groupCount}>{runs.length}</Text>
            </View>

            {runs.map((run) => (
              <Pressable
                key={run.id}
                onPress={() => onSelectRun(run)}
                style={({ hovered: h, pressed }: any) => [
                  styles.routeItem,
                  (h || pressed) && styles.routeItemHover,
                ]}
              >
                <View
                  style={[
                    styles.runDot,
                    {
                      backgroundColor:
                        run.verdict === "verified"
                          ? colors.statusOk
                          : run.verdict === "failed"
                          ? colors.statusErr
                          : colors.warning,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.method,
                    { color: (colors.method as any)[run.method] || colors.text },
                  ]}
                >
                  {run.method}
                </Text>
                <Text style={styles.path} numberOfLines={1}>
                  {run.path}
                </Text>
                {/* the slowest phase, because "it was slow" is only useful with
                    a where attached */}
                {run.phases.length > 0 && (
                  <Text style={styles.runPhase}>
                    {(
                      run.phases.reduce((a, b) => (a.ms > b.ms ? a : b)).ms / 1000
                    ).toFixed(1)}
                    s
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {routes.length === 0 && generatedRoutes.length === 0 && (
          <View style={styles.empty}>
            <Icon name="search" size={22} color={colors.textDim} />
            <Text style={styles.emptyTitle}>No endpoints yet</Text>
            <Text style={styles.emptyBody}>
              Scan a Node.js project folder and ReqFlow will list every route it
              finds.
            </Text>
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.historyBlock}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>Recent</Text>
              {/* The three most recent, not the whole session. A list that grows
                  all day pushes the project's own endpoints off the screen, and
                  the fourth-oldest request is not what anyone comes back to. */}
              <Text style={styles.groupCount}>
                {recentEndpoints(history, RECENT_SHOWN).length}
              </Text>
            </View>
            {recentEndpoints(history, RECENT_SHOWN).map((h) => (
              <Pressable
                key={h.id}
                style={({ hovered: hv }: any) => [
                  styles.routeItem,
                  hv && styles.routeItemHover,
                ]}
                onPress={() => onSelectHistory(h)}
              >
                <Text
                  style={[
                    styles.method,
                    { color: (colors.method as any)[h.method] || colors.text },
                  ]}
                >
                  {h.method}
                </Text>
                <Text style={styles.historyPath} numberOfLines={1}>
                  {h.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                </Text>
                <Text
                  style={[
                    styles.historyStatus,
                    { color: h.status > 0 && h.status < 400 ? colors.statusOk : colors.statusErr },
                  ]}
                >
                  {h.status || "no reply"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {routes.length > 0 && filtered.length === 0 && filteredGenerated.length === 0 && (
          <View style={styles.empty}>
            <Icon name="search" size={22} color={colors.textDim} />
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyBody}>
              Nothing matches "{search}". Try a different method or path.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  codeBtn: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  codeBtnHover: { backgroundColor: colors.hover },
  container: {
    width: 260,
    backgroundColor: colors.surface,
    padding: 12,
    ...shadow.sm,
  },
  header: {
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "500",
  },
  reset: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  resetHover: {
    backgroundColor: colors.hover,
  },
  resetText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  resetTextArmed: {
    color: colors.statusErr,
  },
  scanBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    alignItems: "center",
    ...shadow.sm,
    ...transition("background-color, opacity, transform"),
  },
  scanBtnPressed: {
    opacity: 0.85,
    backgroundColor: colors.accentLight,
  },
  scanBtnText: {
    color: colors.bg,
    fontWeight: "500",
    fontSize: 13,
  },
  fieldLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  baseUrl: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 12,
    ...shadow.sm,
  },
  exportBtn: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
    marginBottom: 12,
    ...transition("background-color"),
  },
  exportBtnHover: {
    backgroundColor: colors.hover,
  },
  exportText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  varsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 6,
  },
  varsBox: {
    marginBottom: 12,
  },
  varRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  varInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
    fontFamily: "monospace",
  },
  varKey: {
    flex: 0.7,
  },
  varRemove: {
    padding: 3,
    borderRadius: radius.sm,
  },
  varAdd: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    ...transition("background-color"),
  },
  varAddHover: {
    backgroundColor: colors.hover,
  },
  varAddText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  varsHint: {
    color: colors.textDim,
    fontSize: 10,
    marginTop: 4,
    fontFamily: "monospace",
  },
  search: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
    marginBottom: 12,
    ...shadow.sm,
    ...transition("box-shadow"),
  },
  list: {
    flex: 1,
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 10,
    marginBottom: 2,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  groupTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  groupCount: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  routeRowRaised: {
    zIndex: 20,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
    ...transition("background-color, border-left-color"),
  },
  routeItemHover: {
    backgroundColor: colors.hover,
  },
  routeItemActive: {
    borderLeftColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  method: {
    fontSize: 11,
    fontWeight: "500",
    width: 50,
    // a long path would otherwise squeeze this box until PATCH sat against the
    // slash, since flex children shrink by default
    flexShrink: 0,
    fontFamily: "monospace",
  },
  path: {
    // takes the rest of the row and ends in an ellipsis, rather than running
    // under the panel edge and cutting a word in half
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: "monospace",
  },
  pathActive: {
    color: colors.text,
  },
  tooltip: {
    // laid over the rows below rather than inserted between them. in normal
    // flow it pushed every route down as the pointer moved, so the list ran
    // away from whatever was being aimed at.
    position: "absolute",
    top: "100%",
    left: 10,
    right: 4,
    zIndex: 20,
    backgroundColor: colors.surfaceLight,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 8,
    ...shadow.md,
  },
  tooltipText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  generatedHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  clearGenerated: {
    padding: 3,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  generatedNote: {
    color: colors.textDim,
    fontSize: 10,
    fontStyle: "italic",
    paddingHorizontal: 8,
    marginBottom: 2,
  },
  generatedPath: {
    // dimmer than a scanned route, because this one is a suggestion and the
    // list has to say which is which without being read closely
    color: colors.textDim,
    opacity: 0.75,
  },
  runDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  runPhase: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: "monospace",
  },
  generatedTag: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 3,
    paddingVertical: 2,
    marginLeft: 6,
    flexShrink: 0,
  },
  historyBlock: {
    marginTop: 6,
  },
  historyPath: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
    fontFamily: "monospace",
  },
  historyStatus: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "500",
  },
  empty: {
    alignItems: "center",
    gap: 8,
    marginTop: 48,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  emptyBody: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
});
