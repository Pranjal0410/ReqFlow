import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import Icon from "./Icon";

interface HeaderRow {
  key: string;
  value: string;
  enabled: boolean;
}

interface Props {
  headers: HeaderRow[];
  onChange: (headers: HeaderRow[]) => void;
  // the query parameter editor is the same rows with different words on them
  keyPlaceholder?: string;
  addLabel?: string;
  emptyHint?: string;
  // query parameters live in the url, and a row that is switched off has
  // nowhere to be written, so it would vanish on the next read. headers are
  // held in the tab, so theirs round-trips.
  showToggle?: boolean;
}

export default function HeadersEditor({
  headers,
  onChange,
  keyPlaceholder = "header name",
  addLabel,
  emptyHint,
  showToggle = true,
}: Props) {
  const updateRow = (index: number, field: "key" | "value", val: string) => {
    const updated = [...headers];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  const toggleRow = (index: number) => {
    const updated = [...headers];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    onChange(updated);
  };

  const removeRow = (index: number) => {
    onChange(headers.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...headers, { key: "", value: "", enabled: true }]);
  };

  return (
    <View style={styles.container}>
      {/* column headers */}
      <View style={styles.headerRow}>
        {showToggle && <View style={{ width: 30 }} />}
        <Text style={[styles.colLabel, { flex: 1 }]}>Key</Text>
        <Text style={[styles.colLabel, { flex: 1 }]}>Value</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView>
        {headers.map((row, i) => (
          <View key={i} style={styles.row}>
            {showToggle && (
              <Pressable style={styles.checkbox} onPress={() => toggleRow(i)}>
                <Icon
                  name={row.enabled ? "check" : "circle"}
                  size={15}
                  color={row.enabled ? colors.statusOk : colors.textDim}
                />
              </Pressable>
            )}

            <TextInput
              style={[styles.input, !row.enabled && styles.disabled]}
              value={row.key}
              onChangeText={(v) => updateRow(i, "key", v)}
              placeholder={keyPlaceholder}
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
            />

            <TextInput
              style={[styles.input, !row.enabled && styles.disabled]}
              value={row.value}
              onChangeText={(v) => updateRow(i, "value", v)}
              placeholder="value"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
            />

            <Pressable
              accessibilityLabel="remove this header"
              style={({ hovered }: any) => [styles.removeBtn, hovered && styles.removeBtnHover]}
              onPress={() => removeRow(i)}
            >
              <Icon name="close" size={14} color={colors.textDim} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      {headers.length === 0 && emptyHint && <Text style={styles.emptyHint}>{emptyHint}</Text>}

      <Pressable
        style={({ hovered }: any) => [styles.addBtn, hovered && styles.addBtnHover]}
        onPress={addRow}
      >
        <Text style={styles.addText}>{addLabel || "+ Add Header"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  colLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  checkbox: {
    width: 24,
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    fontFamily: "monospace",
    ...shadow.sm,
    ...transition("box-shadow, background-color"),
  },
  disabled: {
    opacity: 0.4,
  },
  removeBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  removeBtnHover: {
    backgroundColor: colors.hover,
  },
  removeText: {
    color: colors.textDim,
    fontSize: 16,
  },
  addBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignSelf: "flex-start",
    borderRadius: radius.md,
    ...transition("background-color"),
  },
  addBtnHover: {
    backgroundColor: colors.hover,
  },
  addText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "500",
  },
  emptyHint: {
    color: colors.textDim,
    fontSize: 11,
    paddingVertical: 4,
  },
});
