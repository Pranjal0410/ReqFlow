import React from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  StyleSheet,
} from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { Instruction } from "../types";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  instructions: Instruction[];
  onClose: () => void;
  onChange: (next: Instruction[]) => void;
  // ids the backend reported having put into the last prompt. this is what
  // makes the list a record rather than an assumption: the panel would happily
  // show a rule as active that never reached the model.
  lastSent: string[] | null;
}

// The claim this panel makes is "here is what the agent is following". That is
// only worth showing if it is the real list, so nothing here is inferred: a rule
// is on because the user left it on, and it is marked as having reached the
// model because the backend said which ids it used.
export default function InstructionPanel({
  visible,
  instructions,
  onClose,
  onChange,
  lastSent,
}: Props) {
  const [draft, setDraft] = React.useState("");

  const active = instructions.filter((i) => i.enabled);
  const sent = React.useMemo(() => new Set(lastSent || []), [lastSent]);

  const toggle = (id: string) =>
    onChange(instructions.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)));

  const remove = (id: string) => onChange(instructions.filter((i) => i.id !== id));

  const add = () => {
    const text = draft.trim().replace(/\s+/g, " ");
    if (!text) return;
    // the same rule typed twice is one rule
    if (instructions.some((i) => i.text.toLowerCase() === text.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([
      ...instructions,
      {
        id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
        text,
        enabled: true,
        at: Date.now(),
        source: "manual",
      },
    ]);
    setDraft("");
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>Instructions</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityLabel="close instructions"
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
              onPress={onClose}
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          <Text style={styles.blurb}>
            Rules the agent follows without being asked, so you do not repeat them. It
            saves one when you state a preference; you can add or switch off any of them
            here. Everything switched on is sent with every request.
          </Text>

          <ScrollView style={styles.list} nestedScrollEnabled>
            {instructions.length === 0 && (
              <Text style={styles.empty}>
                Nothing saved yet. Tell the agent how you want code written — "use
                camelCase for JSON fields" — and it keeps the rule.
              </Text>
            )}

            {instructions.map((item) => (
              <View key={item.id} style={styles.row}>
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={({ hovered }: any) => [
                    styles.checkbox,
                    item.enabled && styles.checkboxOn,
                    hovered && styles.checkboxHover,
                  ]}
                  accessibilityLabel={item.enabled ? "switch off" : "switch on"}
                >
                  {item.enabled && <Icon name="check" size={11} color={colors.bg} />}
                </Pressable>

                <View style={styles.rowText}>
                  <Text style={[styles.ruleText, !item.enabled && styles.ruleOff]}>
                    {item.text}
                  </Text>
                  <Text style={styles.meta}>
                    {item.source === "agent" ? "picked up from what you said" : "added by you"}
                    {/* only claimed when the backend reported this id back, so
                        it describes a prompt that really carried the rule */}
                    {sent.has(item.id) ? " · in the last request" : ""}
                  </Text>
                </View>

                <Pressable
                  onPress={() => remove(item.id)}
                  style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
                  accessibilityLabel="forget this instruction"
                >
                  <Icon name="close" size={12} color={colors.textDim} />
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={add}
              placeholder="Add a rule — e.g. always paginate list endpoints"
              placeholderTextColor={colors.textDim}
              returnKeyType="done"
            />
            <Pressable
              accessibilityLabel="add this instruction"
              disabled={!draft.trim()}
              onPress={add}
              style={({ hovered }: any) => [
                styles.addBtn,
                hovered && styles.addBtnHover,
                !draft.trim() && styles.addBtnDisabled,
              ]}
            >
              <Icon name="plus" size={13} color={colors.bg} />
            </Pressable>
          </View>

          <Text style={styles.footer}>
            {active.length === 0
              ? "None switched on, so nothing is being added to the agent's prompt."
              : `${active.length} of ${instructions.length} switched on and sent with every request.`}
          </Text>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  iconBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  iconBtnHover: {
    backgroundColor: colors.hover,
  },
  blurb: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 6,
  },
  list: {
    marginTop: 12,
    flexGrow: 0,
  },
  empty: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 19,
    paddingVertical: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    ...transition("background-color"),
  },
  checkboxHover: {
    borderColor: colors.textDim,
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  ruleText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  ruleOff: {
    color: colors.textDim,
    textDecorationLine: "line-through",
  },
  meta: {
    color: colors.textDim,
    fontSize: 10,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 12,
    outlineStyle: "none" as any,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    ...transition("opacity"),
  },
  addBtnHover: {
    opacity: 0.88,
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
  footer: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: 12,
  },
});
