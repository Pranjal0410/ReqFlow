import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, TextInput } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { Instruction, RunningProject } from "../types";
import { ExampleLimit } from "../lib/examples";
import { ModelStatus } from "./StatusBar";
import Icon from "./Icon";
import { saveModelSettings, ModelSettings } from "../services/api";

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

// The three engines, in the order a developer would consider them.
const ENGINES: { id: "gemini" | "local" | "embedded"; name: string; hint: string }[] = [
  { id: "gemini", name: "Gemini", hint: "hosted, and the default" },
  { id: "local", name: "Local runtime", hint: "Ollama or anything OpenAI-compatible" },
  { id: "embedded", name: "In this app", hint: "a .gguf file, nothing to run" },
];

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

  const settings = model?.settings;

  const [provider, setProvider] = React.useState(settings?.provider ?? "gemini");
  const [apiKey, setApiKey] = React.useState("");
  const [localModelUrl, setLocalModelUrl] = React.useState(settings?.localModelUrl ?? "");
  const [localModelPath, setLocalModelPath] = React.useState(settings?.localModelPath ?? "");
  const [localModel, setLocalModel] = React.useState(settings?.localModel ?? "");
  const [saving, setSaving] = React.useState(false);
  const [saveNote, setSaveNote] = React.useState("");

  // Re-seeded when the panel opens rather than on every render: a field the user
  // is typing into must not be overwritten by a status poll landing underneath
  // them. The key box is always empty, because nothing here ever holds one.
  React.useEffect(() => {
    if (!visible) return;
    setProvider(settings?.provider ?? "gemini");
    setLocalModelUrl(settings?.localModelUrl ?? "");
    setLocalModelPath(settings?.localModelPath ?? "");
    setLocalModel(settings?.localModel ?? "");
    setApiKey("");
    setSaveNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dirty =
    !!apiKey.trim() ||
    provider !== (settings?.provider ?? "gemini") ||
    localModelUrl !== (settings?.localModelUrl ?? "") ||
    localModelPath !== (settings?.localModelPath ?? "") ||
    localModel !== (settings?.localModel ?? "");

  const save = async () => {
    setSaving(true);
    setSaveNote("");
    try {
      const result = await saveModelSettings({
        provider,
        // an empty box means "keep the key you have", never "delete it"
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        localModelUrl,
        localModelPath,
        localModel,
      });
      setApiKey("");
      setSaveNote(
        result.detail ||
          "Saved. Checking whether it answers…"
      );
      // the setting is live now, so the only honest next step is to ask the
      // provider rather than to report success on our own authority
      onRecheckModel();
    } catch (err: any) {
      setSaveNote(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

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

            {/* The three engines, as a choice rather than a line in a file the
                user has to find. Switching takes effect on the next request —
                the backend applies it to itself before writing it down — so this
                is a setting, not an instruction to go and restart something. */}
            <View style={styles.choices}>
              {ENGINES.map((engine) => (
                <Pressable
                  key={engine.id}
                  onPress={() => setProvider(engine.id)}
                  style={({ hovered }: any) => [
                    styles.choice,
                    provider === engine.id && styles.choiceOn,
                    hovered && provider !== engine.id && styles.choiceHover,
                  ]}
                >
                  <Text
                    style={[styles.choiceName, provider === engine.id && styles.choiceNameOn]}
                  >
                    {engine.name}
                  </Text>
                  <Text style={styles.choiceHint}>{engine.hint}</Text>
                </Pressable>
              ))}
            </View>

            {provider === "gemini" && (
              <Row
                label="API key"
                hint={
                  settings?.keySet
                    ? "one is stored — type a new one to replace it"
                    : "no key stored, so nothing can be generated"
                }
              >
                <TextInput
                  style={styles.input}
                  value={apiKey}
                  onChangeText={setApiKey}
                  placeholder={settings?.keySet ? "•••••••• stored" : "paste your key"}
                  placeholderTextColor={colors.textDim}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </Row>
            )}

            {provider === "local" && (
              <>
                <Row label="Runtime URL" hint="an OpenAI-compatible server you are already running">
                  <TextInput
                    style={styles.input}
                    value={localModelUrl}
                    onChangeText={setLocalModelUrl}
                    placeholder="http://localhost:11434/v1"
                    placeholderTextColor={colors.textDim}
                    autoCapitalize="none"
                  />
                </Row>
                <Row label="Model name" hint="as that runtime lists it">
                  <TextInput
                    style={styles.input}
                    value={localModel}
                    onChangeText={setLocalModel}
                    placeholder="qwen2.5-coder"
                    placeholderTextColor={colors.textDim}
                    autoCapitalize="none"
                  />
                </Row>
              </>
            )}

            {provider === "embedded" && (
              <Row label="Model file" hint="a .gguf loaded inside this app, nothing to run">
                <TextInput
                  style={styles.input}
                  value={localModelPath}
                  onChangeText={setLocalModelPath}
                  placeholder="/path/to/model.gguf"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                />
              </Row>
            )}

            <View style={styles.saveRow}>
              {/* said before the button, not after: whether a change will
                  outlive the session is something to know while deciding */}
              <Text style={[styles.note, styles.saveNote]}>
                {saveNote ||
                  (settings && !settings.writable
                    ? `Changes apply now but cannot be written to ${settings.storedAt}, so they will not survive a restart.`
                    : "Applies to the next request. Gemini is the default; a local model is for work that cannot leave this machine — on the benchmark in this repository it was substantially slower, so it is an offline option rather than a faster one.")}
              </Text>
              <Pressable
                disabled={saving || !dirty}
                onPress={save}
                style={({ hovered }: any) => [
                  styles.saveBtn,
                  hovered && styles.saveBtnHover,
                  (saving || !dirty) && styles.saveBtnDisabled,
                ]}
              >
                <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            </View>

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
  choices: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    marginBottom: 4,
  },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    ...transition("background-color"),
  },
  choiceHover: { backgroundColor: colors.hover },
  choiceOn: { backgroundColor: colors.surfaceLight, borderColor: colors.textDim },
  choiceName: { color: colors.textMuted, fontSize: 12, fontWeight: "500" },
  choiceNameOn: { color: colors.text },
  choiceHint: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: colors.text,
    fontSize: 12,
    fontFamily: "monospace",
    minWidth: 220,
    outlineStyle: "none" as any,
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 12,
  },
  saveNote: { flex: 1 },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 7,
    ...transition("opacity"),
  },
  saveBtnHover: { opacity: 0.88 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: colors.bg, fontSize: 12, fontWeight: "500" },
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
