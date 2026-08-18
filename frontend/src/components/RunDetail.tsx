import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { RunRecord } from "../types";
import { verdictLabel } from "../lib/verdict";
import Icon from "./Icon";

interface Props {
  run: RunRecord | null;
  onClose: () => void;
  // shown only when the code that produced this run is still on hand
  onOpenCode: (() => void) | null;
  onOpenRequest: () => void;
}

// What happened when this endpoint was applied, kept after the code view closed.
//
// Clicking one of these used to raise the error toast — a single line, in the
// colour reserved for failures, for runs that had succeeded. The run is a record
// of work done to the developer's project, so it gets somewhere to be read.
//
// Every line here was measured by the backend and stored with the run. Nothing
// is recomputed at display time, because a number that changes when you open a
// panel is not a record of anything.
export default function RunDetail({ run, onClose, onOpenCode, onOpenRequest }: Props) {
  if (!run) return null;

  const tone =
    run.verdict === "verified"
      ? colors.statusOk
      : run.verdict === "failed"
      ? colors.statusErr
      : colors.warning;

  const total = run.phases.reduce((sum, p) => sum + p.ms, 0);
  const when = new Date(run.at);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text style={styles.title}>
              {run.method} {run.path}
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityLabel="close"
              onPress={onClose}
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          <Text style={[styles.verdict, { color: tone }]}>{verdictLabel(run.verdict)}</Text>
          <Text style={styles.when}>
            {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {total > 0 ? ` · ${(total / 1000).toFixed(1)}s in total` : ""}
          </Text>

          <ScrollView style={styles.body} nestedScrollEnabled>
            {!!run.text && <Text style={styles.text}>{run.text}</Text>}

            {run.phases.length > 0 && (
              <>
                <Text style={styles.section}>Where the time went</Text>
                {run.phases.map((p, i) => (
                  <View key={i} style={styles.phase}>
                    <Text style={styles.phaseName}>{p.phase}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${total > 0 ? Math.max((p.ms / total) * 100, 2) : 0}%`,
                            backgroundColor: tone,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.phaseMs}>{(p.ms / 1000).toFixed(1)}s</Text>
                  </View>
                ))}
                {/* said plainly, because a breakdown with no scope invites the
                    reader to assume it covers the whole wait */}
                <Text style={styles.note}>
                  Measured on the ReqFlow backend, from the write to the verdict.
                </Text>
              </>
            )}
          </ScrollView>

          <View style={styles.actions}>
            {onOpenCode && (
              <Pressable
                onPress={onOpenCode}
                style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
              >
                <Text style={styles.btnText}>Open the code</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onOpenRequest}
              style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
            >
              <Text style={styles.btnText}>Open a request tab</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
    width: "100%",
    maxWidth: 560,
    maxHeight: "88%",
    ...shadow.md,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  title: { color: colors.text, fontSize: 14, fontWeight: "500", fontFamily: "monospace" },
  iconBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  iconBtnHover: { backgroundColor: colors.hover },
  verdict: { fontSize: 12, fontWeight: "500", marginTop: 12 },
  when: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  body: { marginTop: 14, flexGrow: 0 },
  text: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  section: {
    color: colors.textDim,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 7,
  },
  phase: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  phaseName: { color: colors.textMuted, fontSize: 11, width: 140 },
  barTrack: { flex: 1, height: 4, backgroundColor: colors.bg, borderRadius: 2 },
  barFill: { height: 4, borderRadius: 2 },
  phaseMs: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    width: 42,
    textAlign: "right",
  },
  note: { color: colors.textDim, fontSize: 11, lineHeight: 17, marginTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  btn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...transition("background-color"),
  },
  btnHover: { backgroundColor: colors.hover },
  btnText: { color: colors.textMuted, fontSize: 12 },
});
