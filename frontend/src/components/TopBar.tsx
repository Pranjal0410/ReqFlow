import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";

interface Props {
  projectName: string;
  // origin of the server the active request points at, e.g. http://localhost:3001
  target: string | null;
  // true up, false unreachable, null not checked yet or no target
  targetUp: boolean | null;
}

export default function TopBar({ projectName, target, targetUp }: Props) {
  const host = target ? target.replace(/^https?:\/\//, "") : null;

  const state = !host
    ? { color: colors.textDim, tint: "rgba(255,255,255,0.06)", label: "No target" }
    : targetUp === null
    ? { color: colors.textDim, tint: "rgba(255,255,255,0.06)", label: `Checking ${host}` }
    : targetUp
    ? { color: colors.statusOk, tint: "rgba(74, 222, 128, 0.12)", label: `Running ${host}` }
    : { color: colors.statusErr, tint: "rgba(248, 113, 113, 0.12)", label: `Unreachable ${host}` };

  return (
    <View style={styles.container}>
      {/* left: project info */}
      <View style={styles.left}>
        <View style={styles.icon}>
          <Text style={styles.iconText}>
            {projectName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View>
          <Text style={styles.projectName}>{projectName || "ReqFlow"}</Text>
          <Text style={styles.projectType}>Node.js Project</Text>
        </View>
      </View>

      {/* center: current section. the other nav items were dropped because
          nothing was wired behind them */}
      <View style={styles.center}>
        <Text style={[styles.navTab, styles.activeNavTab]}>API Explorer</Text>
      </View>

      {/* right: real reachability of the server the active request targets.
          polled through the proxy, so it reflects the actual connection */}
      <View style={styles.right}>
        <View style={[styles.statusBadge, { backgroundColor: state.tint }]}>
          <View style={[styles.statusDot, { backgroundColor: state.color }]} />
          <Text style={[styles.statusText, { color: state.color }]}>{state.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    zIndex: 3,
    ...shadow.bar,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    color: colors.bg,
    fontWeight: "500",
    fontSize: 14,
  },
  projectName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  projectType: {
    color: colors.textDim,
    fontSize: 10,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
  },
  center: {
    flexDirection: "row",
    gap: 4,
  },
  navTab: {
    color: colors.textDim,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontWeight: "500",
  },
  activeNavTab: {
    color: colors.text,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
