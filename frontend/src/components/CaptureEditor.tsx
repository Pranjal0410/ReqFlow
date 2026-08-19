import React from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius } from "../theme/tokens";
import Icon from "./Icon";
import { Capture, suggestions, isUsableName } from "../lib/capture";
import { ApiResponse } from "../types";

interface Props {
  captures: Capture[];
  onChange: (captures: Capture[]) => void;
  response: ApiResponse | null;
}

export default function CaptureEditor({ captures, onChange, response }: Props) {
  const rules = captures || [];

  const add = (from = "", name = "") =>
    onChange([
      ...rules,
      { id: Date.now().toString() + Math.random().toString(36).slice(2), from, name, lastValue: null },
    ]);

  const update = (id: string, patch: Partial<Capture>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));

  // paths taken from the body actually on screen, so the first rule is one
  // press rather than a path typed from memory against a shape half remembered
  const offered = React.useMemo(
    () => (response ? suggestions(response.data) : []),
    [response]
  );
  const unused = offered.filter((o) => !rules.some((r) => r.from === o.path));

  // the name a path suggests: data.id on a create is the id of the thing made
  const nameFor = (path: string) => {
    const last = path.split(".").filter((p) => !/^\d+$/.test(p)).pop() || "value";
    return last.replace(/^_+/, "");
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.title}>Capture</Text>
        <Text style={styles.subtitle}>saved after each send, usable as {"{{name}}"} anywhere</Text>
      </View>

      <ScrollView>
        {rules.map((rule) => {
          const badName = rule.name.trim().length > 0 && !isUsableName(rule.name);
          return (
            <View key={rule.id} style={styles.row}>
              <View style={styles.indicator}>
                <Icon
                  name={rule.lastValue ? "check" : "circle"}
                  size={rule.lastValue ? 15 : 14}
                  color={rule.lastValue ? colors.statusOk : colors.textDim}
                />
              </View>

              <TextInput
                style={styles.fromInput}
                value={rule.from}
                onChangeText={(v) => update(rule.id, { from: v })}
                placeholder="data.id"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.arrow}>as</Text>

              <TextInput
                style={[styles.nameInput, badName && styles.nameInputBad]}
                value={rule.name}
                onChangeText={(v) => update(rule.id, { name: v })}
                placeholder="incidentId"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* what it holds right now. A rule that quietly does nothing looks
                  exactly like a rule that was never added, so the value it found
                  is shown beside it rather than only in the variables panel. */}
              <Text style={styles.value} numberOfLines={1}>
                {badName
                  ? "letters, numbers, . _ - only"
                  : rule.lastValue
                    ? rule.lastValue
                    : "nothing yet"}
              </Text>

              <TouchableOpacity
                onPress={() => remove(rule.id)}
                accessibilityLabel="remove this capture"
              >
                <Icon name="close" size={14} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          );
        })}

        {rules.length === 0 && (
          <Text style={styles.empty}>
            Nothing captured from this response yet. A create answers with the id every later
            request needs, and a login answers with the token — take it here once and the rest of
            the workspace can use it.
          </Text>
        )}

        {unused.length > 0 && (
          <View style={styles.offered}>
            <Text style={styles.offeredTitle}>In this response</Text>
            <View style={styles.chips}>
              {unused.map((o) => (
                <TouchableOpacity
                  key={o.path}
                  style={styles.chip}
                  onPress={() => add(o.path, nameFor(o.path))}
                >
                  <Text style={styles.chipPath}>{o.path}</Text>
                  <Text style={styles.chipValue} numberOfLines={1}>
                    {o.value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.addBtn} onPress={() => add()}>
          <Text style={styles.addText}>+ Add Capture</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 4 },
  topRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 10 },
  title: { color: colors.text, fontSize: 13, fontWeight: "600" },
  subtitle: { color: colors.textDim, fontSize: 11 },

  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  indicator: { width: 18, alignItems: "center" },

  fromInput: {
    flex: 1.1,
    color: colors.text,
    fontSize: 12,
    fontFamily: "monospace" as any,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  arrow: { color: colors.textDim, fontSize: 11 },
  nameInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontFamily: "monospace" as any,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  nameInputBad: { borderColor: colors.statusErr },
  value: { flex: 1.2, color: colors.textDim, fontSize: 11, fontFamily: "monospace" as any },

  empty: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: 12 },

  offered: { marginTop: 6 },
  offeredTitle: { color: colors.textDim, fontSize: 11, marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 260,
  },
  chipPath: { color: colors.text, fontSize: 11, fontFamily: "monospace" as any },
  chipValue: { color: colors.textDim, fontSize: 11, fontFamily: "monospace" as any, flexShrink: 1 },

  actions: { flexDirection: "row", marginTop: 8 },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addText: { color: colors.textDim, fontSize: 12 },
});
