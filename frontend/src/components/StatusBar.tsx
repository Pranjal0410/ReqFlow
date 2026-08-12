import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

interface Props {
  workspace: string;
  target: string | null;
  targetUp: boolean | null;
  requestCount: number;
}

export default function AppStatusBar({
  workspace,
  target,
  targetUp,
  requestCount,
}: Props) {
  const host = target ? target.replace(/^https?:\/\//, "") : null;

  // one origin is polled, so the label names that origin. saying "all services
  // operational" would be claiming something never checked
  const state = !host
    ? { color: colors.textDim, label: "No target selected" }
    : targetUp === null
    ? { color: colors.textDim, label: `Checking ${host}` }
    : targetUp
    ? { color: colors.statusOk, label: `${host} responding` }
    : { color: colors.statusErr, label: `${host} not responding` };

  return (
    <View style={styles.bar}>
      <Text style={styles.workspace}>{workspace}</Text>
      <Text style={styles.sep}>·</Text>

      <View style={[styles.dot, { backgroundColor: state.color }]} />
      <Text style={[styles.status, { color: state.color }]}>{state.label}</Text>

      <View style={{ flex: 1 }} />

      {requestCount > 0 && (
        <Text style={styles.meta}>
          {requestCount} request{requestCount === 1 ? "" : "s"} this session
        </Text>
      )}
      {host && <Text style={styles.meta}>{host}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  workspace: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  sep: {
    color: colors.textDim,
    fontSize: 11,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  status: {
    fontSize: 11,
    fontWeight: "500",
  },
  meta: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    marginLeft: 14,
  },
});
