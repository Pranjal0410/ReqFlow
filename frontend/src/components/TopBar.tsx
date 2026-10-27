import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import Icon from "./Icon";
import Logo from "./Logo";

interface Props {
  projectName: string;
  routeCount: number;
  // origin of the server the active request points at, e.g. http://localhost:3001
  target: string | null;
  // true up, false unreachable, null not checked yet or no target
  targetUp: boolean | null;
  // set while the mock server is running and BASE_URL points at it — shown
  // instead of the ordinary reachability badge, since "Running 127.0.0.1:port"
  // reads exactly like a real server came up, which is the one thing sending
  // a request without one should never suggest
  mockPort: number | null;
  // how many standing rules are switched on. shown as a number rather than a
  // dot, because "the agent is following three rules you cannot see from here"
  // is the thing worth knowing at a glance.
  instructionCount: number;
  onOpenInstructions: () => void;
  onOpenSettings: () => void;
}

export default function TopBar({
  projectName,
  routeCount,
  target,
  targetUp,
  mockPort,
  instructionCount,
  onOpenInstructions,
  onOpenSettings,
}: Props) {
  // only http is dropped. leaving https visible is what tells you the tab is
  // asking for a scheme the server does not speak, which otherwise looks
  // identical to the address that works.
  const host = target ? target.replace(/^http:\/\//, "") : null;

  const state = mockPort
    ? { color: colors.statusOk, tint: "rgba(74, 222, 128, 0.12)", label: `Mock server running :${mockPort}` }
    : !host
    ? { color: colors.textDim, tint: "rgba(255,255,255,0.06)", label: "No target" }
    : targetUp === null
    ? { color: colors.textDim, tint: "rgba(255,255,255,0.06)", label: `Checking ${host}` }
    : targetUp
    ? { color: colors.statusOk, tint: "rgba(74, 222, 128, 0.12)", label: `Running ${host}` }
    : { color: colors.statusErr, tint: "rgba(248, 113, 113, 0.12)", label: `Unreachable ${host}` };

  return (
    <View style={styles.container}>
      {/* left: the product, then the project. The first initial of whatever
          folder was scanned is not a logo — it changed identity with the
          project, so the app had no mark of its own anywhere. */}
      <View style={styles.left}>
        <View style={styles.icon} accessibilityLabel="ReqFlow">
          <Logo size={17} color={colors.bg} />
        </View>
        <View>
          {/* The product first, the project under it. Until now the header
              showed only the scanned folder's name, so the app never said what
              it was — a first launch answered "what project is this" and left
              "what is this" to the window title. */}
          <Text style={styles.productName}>ReqFlow</Text>
          <Text style={styles.projectType} numberOfLines={1}>
            {projectName && projectName !== "ReqFlow" ? projectName : "no project yet"}
            {routeCount > 0 ? ` · ${routeCount} endpoint${routeCount === 1 ? "" : "s"}` : ""}
          </Text>
        </View>
      </View>

      {/* center: current section. the other nav items were dropped because
          nothing was wired behind them. "Explorer" undersold it once the app
          could write endpoints as well as call them. */}
      <View style={styles.center}>
        <Text style={[styles.navTab, styles.activeNavTab]}>API Builder</Text>
      </View>

      {/* right: real reachability of the server the active request targets.
          polled through the proxy, so it reflects the actual connection */}
      <View style={styles.right}>
        <Pressable
          onPress={onOpenInstructions}
          style={({ hovered }: any) => [styles.instructions, hovered && styles.instructionsHover]}
          accessibilityLabel="standing instructions the agent follows"
        >
          <Icon name="check" size={11} color={colors.textDim} />
          <Text style={styles.instructionsText}>
            {instructionCount > 0
              ? `${instructionCount} instruction${instructionCount === 1 ? "" : "s"}`
              : "Instructions"}
          </Text>
        </Pressable>

        <Pressable
          onPress={onOpenSettings}
          style={({ hovered }: any) => [styles.instructions, hovered && styles.instructionsHover]}
          accessibilityLabel="settings"
        >
          <Icon name="terminal" size={11} color={colors.textDim} />
          <Text style={styles.instructionsText}>Settings</Text>
        </Pressable>

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
  productName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: -0.1,
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
  instructions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    ...transition("background-color"),
  },
  instructionsHover: {
    backgroundColor: colors.hover,
  },
  instructionsText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
});
