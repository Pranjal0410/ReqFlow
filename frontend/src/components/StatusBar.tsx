import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, transition } from "../theme/tokens";
import { RunningProject } from "../types";
import { ModelSettings } from "../services/api";

export interface ModelStatus {
  ok: boolean;
  provider: string;
  model: string;
  local: boolean;
  detail: string;
  // what Settings can change. never carries the key itself — only whether one
  // is set — so no part of the UI can put a credential on screen.
  settings?: ModelSettings;
}

interface Props {
  workspace: string;
  requestCount: number;
  // which model is doing the work, checked rather than read off a config file.
  // null until the backend has answered.
  model: ModelStatus | null;
  // the project ReqFlow started itself, if any. named here because a process
  // this app spawned that the developer cannot see or stop is their machine
  // running something they never chose.
  runningProject: RunningProject | null;
  onStopProject: () => void;
}

export default function AppStatusBar({
  workspace,
  requestCount,
  model,
  runningProject,
  onStopProject,
}: Props) {
  // Whether the target answers is now said once, in the badge at the top right.
  // It used to be said here as well, in different words and a different colour —
  // "Unreachable localhost:3411" up there and "localhost:3411 not responding"
  // down here. One fact stated twice invites the reader to look for the
  // difference between the two statements.

  return (
    <View style={styles.bar}>
      <Text style={styles.workspace}>{workspace}</Text>

      <View style={{ flex: 1 }} />

      {/* Said plainly, with the way out beside it. ReqFlow starts the project
          so that applying a change and finding out whether it worked is one
          action; the price of that is a process the developer did not start, and
          the least it owes them is to say so and offer to stop. */}
      {runningProject && (
        <View style={styles.owned}>
          <View style={[styles.dot, { backgroundColor: colors.info }]} />
          <Text style={styles.ownedText} numberOfLines={1}>
            ReqFlow is running your server
            <Text style={styles.ownedCommand}> · {runningProject.command}</Text>
          </Text>
          <Pressable
            onPress={onStopProject}
            style={({ hovered }: any) => [styles.stop, hovered && styles.stopHover]}
          >
            <Text style={styles.stopText}>Stop</Text>
          </Pressable>
        </View>
      )}

      {/* whether the code being scanned leaves this machine is not a detail,
          so the engine is named rather than left to the config file. the state
          comes from a real call to the provider, not from a key being present. */}
      {model && (
        <Text
          style={[styles.meta, !model.ok && { color: colors.statusErr }]}
          numberOfLines={1}
        >
          {model.ok
            ? `${model.model}${model.local ? " · on this machine" : " · cloud"}`
            : `${model.model} unavailable`}
        </Text>
      )}
      {requestCount > 0 && (
        <Text style={styles.meta}>
          {requestCount} request{requestCount === 1 ? "" : "s"} this session
        </Text>
      )}
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
  owned: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 14,
  },
  ownedText: {
    color: colors.info,
    fontSize: 11,
    fontWeight: "500",
  },
  ownedCommand: {
    color: colors.textDim,
    fontWeight: "400",
    fontFamily: "monospace",
  },
  stop: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  stopHover: {
    backgroundColor: colors.hover,
  },
  stopText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "500",
  },
});
