import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { Instruction, RunningProject } from "../types";
import { ExampleLimit } from "../lib/examples";
import { ModelStatus } from "./StatusBar";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  onClose: () => void;

  model: ModelStatus | null;
  onRecheckModel: () => void;

  instructions: Instruction[];
  onOpenInstructions: () => void;

  exampleLimit: ExampleLimit;
  onExampleLimitChange: (limit: ExampleLimit) => void;
  exampleCount: number;
  onClearExamples: () => void;

  projectPath: string;
  runningProject: RunningProject | null;
  onStopProject: () => void;
}

// One place for the things a developer actually has to decide, instead of the
// three they were spread across: an environment variable for the model, a panel
// of its own for instructions, and a control buried in the examples list.
//
// It is deliberately not a preferences tree. Everything here is either something
// the app is doing right now — which model is answering, which server it is
// running — or a limit with two values. Anything that has one sensible answer
// stays out.
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      <View style={styles.rowControl}>{children}</View>
    </View>
  );
}

export default function SettingsPanel({
  visible,
  onClose,
  model,
  onRecheckModel,
  instructions,
  onOpenInstructions,
  exampleLimit,
  onExampleLimitChange,
  exampleCount,
  onClearExamples,
  projectPath,
  runningProject,
  onStopProject,
}: Props) {
  const active = instructions.filter((i) => i.enabled).length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
              onPress={onClose}
              accessibilityLabel="close settings"
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} nestedScrollEnabled>
            <Text style={styles.section}>Model</Text>

            {/* Reported from a real call to the provider, never from the config:
                a key being present says nothing about it being accepted, and a
                model file existing says nothing about it loading. */}
            <Row
              label={model ? model.model : "checking…"}
              hint={
                model
                  ? `${model.local ? "running on this machine" : "hosted"} · ${model.detail}`
                  : "asking the provider whether it answers"
              }
            >
              <View style={styles.statusPair}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: model?.ok ? colors.statusOk : colors.statusErr },
                  ]}
                />
                <Pressable
                  onPress={onRecheckModel}
                  style={({ hovered }: any) => [styles.smallBtn, hovered && styles.smallBtnHover]}
                >
                  <Text style={styles.smallBtnText}>Re-check</Text>
                </Pressable>
              </View>
            </Row>

            <Text style={styles.note}>
              Gemini is the default. A local model is available for work that cannot leave the
              machine — on the benchmark in this repository it was substantially slower and did
              not complete the tasks, so it is an offline option rather than a faster one. Set
              LLM_PROVIDER in backend/.env to change it.
            </Text>

            <Text style={styles.section}>Project</Text>

            <Row label="Folder" hint={projectPath || "nothing scanned yet"}>
              <View />
            </Row>

            {/* The app starts the developer's server so that applying a change
                and finding out whether it worked is one action. A process it
                started that they cannot see or stop is not a convenience. */}
            <Row
              label="Development server"
              hint={
                runningProject
                  ? `ReqFlow started it · ${runningProject.command}`
                  : "not started by ReqFlow"
              }
            >
              {runningProject ? (
                <Pressable
                  onPress={onStopProject}
                  style={({ hovered }: any) => [styles.smallBtn, hovered && styles.smallBtnHover]}
                >
                  <Text style={styles.smallBtnText}>Stop</Text>
                </Pressable>
              ) : (
                <View />
              )}
            </Row>

            <Text style={styles.section}>Memory</Text>

            <Row
              label="Instructions"
              hint={
                instructions.length === 0
                  ? "none yet — the agent saves one when you state a preference"
                  : `${active} of ${instructions.length} switched on and sent with every request`
              }
            >
              <Pressable
                onPress={onOpenInstructions}
                style={({ hovered }: any) => [styles.smallBtn, hovered && styles.smallBtnHover]}
              >
                <Text style={styles.smallBtnText}>Manage</Text>
              </Pressable>
            </Row>

            <Row
              label="Examples kept per endpoint"
              hint={
                exampleCount === 0
                  ? "every send is kept; nothing on file yet"
                  : `${exampleCount} on file for the endpoint you are looking at`
              }
            >
              <View style={styles.limitRow}>
                {([3, 5] as ExampleLimit[]).map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => onExampleLimitChange(n)}
                    style={({ hovered }: any) => [
                      styles.limitBtn,
                      exampleLimit === n && styles.limitBtnOn,
                      hovered && exampleLimit !== n && styles.smallBtnHover,
                    ]}
                  >
                    <Text style={[styles.limitText, exampleLimit === n && styles.limitTextOn]}>
                      {n}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={onClearExamples}
                  style={({ hovered }: any) => [styles.smallBtn, hovered && styles.smallBtnHover]}
                >
                  <Text style={styles.smallBtnText}>Clear</Text>
                </Pressable>
              </View>
            </Row>

            <Text style={styles.note}>
              Credentials are removed before an example is written to disk — the header stays so
              the request still reads as an authorised one, its value does not, and the same rule
              runs over the fields of a JSON body.
            </Text>
          </ScrollView>
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
    maxWidth: 620,
    maxHeight: "88%",
    ...shadow.md,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: colors.text, fontSize: 15, fontWeight: "500" },
  iconBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  iconBtnHover: { backgroundColor: colors.hover },
  body: { marginTop: 8, flexGrow: 0 },
  section: {
    color: colors.textDim,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 12 },
  rowHint: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  rowControl: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusPair: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  smallBtnHover: { backgroundColor: colors.hover },
  smallBtnText: { color: colors.textMuted, fontSize: 11, fontWeight: "500" },
  limitRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  limitBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  limitBtnOn: { backgroundColor: colors.surfaceLight, borderColor: colors.textDim },
  limitText: { color: colors.textDim, fontSize: 11, fontFamily: "monospace" },
  limitTextOn: { color: colors.text },
  note: { color: colors.textDim, fontSize: 11, lineHeight: 17, marginTop: 10 },
});
