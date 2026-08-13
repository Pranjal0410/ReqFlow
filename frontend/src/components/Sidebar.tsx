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
import { DetectedRoute, HistoryEntry } from "../types";
import { Variable, isSecretVariable } from "../lib/variables";
import * as Clipboard from "expo-clipboard";

interface Props {
  routes: DetectedRoute[];
  onSelectRoute: (route: DetectedRoute) => void;
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
}

export default function Sidebar({
  routes,
  onSelectRoute,
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

  const filtered = routes.filter(
    (r) =>
      r.path.toLowerCase().includes(search.toLowerCase()) ||
      r.method.toLowerCase().includes(search.toLowerCase())
  );

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
          <Text style={styles.title}>API Explorer</Text>
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
        placeholder="Search APIs..."
        placeholderTextColor={colors.textDim}
        value={search}
        onChangeText={setSearch}
      />

      <ScrollView style={styles.list}>
        {Object.entries(grouped).map(([group, groupRoutes]) => (
          <View key={group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>
                {group.charAt(0).toUpperCase() + group.slice(1)}
              </Text>
              <Text style={styles.groupCount}>{groupRoutes.length}</Text>
            </View>
            {groupRoutes.map((route, i) => {
              const key = `${route.method} ${route.path}`;
              const active = activePath === key;
              return (
                <View key={i}>
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
                    <Text style={[styles.path, active && styles.pathActive]}>
                      {route.path}
                    </Text>
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

        {routes.length === 0 && (
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
              <Text style={styles.groupCount}>{history.length}</Text>
            </View>
            {history.map((h) => (
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
                  {h.status || "err"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {routes.length > 0 && filtered.length === 0 && (
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
    fontFamily: "monospace",
  },
  path: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: "monospace",
  },
  pathActive: {
    color: colors.text,
  },
  tooltip: {
    marginTop: 2,
    marginBottom: 4,
    marginLeft: 10,
    backgroundColor: colors.surfaceLight,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 8,
    ...shadow.sm,
  },
  tooltipText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
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
