import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";
import Icon from "./Icon";
import { runAssertions } from "../lib/assertions";

interface TestCase {
  id: string;
  field: string;
  operator: string;
  value: string;
  passed: boolean | null;
}

interface Props {
  tests: TestCase[];
  onChange: (tests: TestCase[]) => void;
  response: any;
}

const OPERATORS = ["equals", "not equals", "contains", "exists", "greater than", "less than"];

export default function TestRunner({ tests, onChange, response }: Props) {
  const addTest = () => {
    onChange([
      ...tests,
      {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        field: "status",
        operator: "equals",
        value: "200",
        passed: null,
      },
    ]);
  };

  const updateTest = (id: string, updates: Partial<TestCase>) => {
    onChange(tests.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const removeTest = (id: string) => {
    onChange(tests.filter((t) => t.id !== id));
  };

  const runTests = () => {
    if (!response) return;
    onChange(runAssertions(tests, response));
  };

  const passCount = tests.filter((t) => t.passed === true).length;
  const failCount = tests.filter((t) => t.passed === false).length;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.title}>Assertions</Text>
        <Text style={styles.subtitle}>run automatically after each send</Text>
        {tests.length > 0 && tests[0].passed !== null && (
          <View style={styles.summary}>
            <Text style={[styles.summaryText, { color: colors.statusOk }]}>
              {passCount} passed
            </Text>
            <Text style={[styles.summaryText, { color: colors.statusErr }]}>
              {failCount} failed
            </Text>
          </View>
        )}
      </View>

      <ScrollView>
        {tests.map((test) => (
          <View key={test.id} style={styles.testRow}>
            {/* pass/fail indicator */}
            <View style={styles.indicator}>
              {test.passed === null && (
                <Icon name="circle" size={14} color={colors.textDim} />
              )}
              {test.passed === true && (
                <Icon name="check" size={15} color={colors.statusOk} />
              )}
              {test.passed === false && (
                <Icon name="x" size={15} color={colors.statusErr} />
              )}
            </View>

            {/* field */}
            <TextInput
              style={styles.fieldInput}
              value={test.field}
              onChangeText={(v) => updateTest(test.id, { field: v, passed: null })}
              placeholder="status"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
            />

            {/* operator picker */}
            <TouchableOpacity
              style={styles.operatorBtn}
              onPress={() => {
                const currentIndex = OPERATORS.indexOf(test.operator);
                const nextIndex = (currentIndex + 1) % OPERATORS.length;
                updateTest(test.id, { operator: OPERATORS[nextIndex], passed: null });
              }}
            >
              <Text style={styles.operatorText}>{test.operator}</Text>
            </TouchableOpacity>

            {/* value */}
            {test.operator !== "exists" && (
              <TextInput
                style={styles.valueInput}
                value={test.value}
                onChangeText={(v) => updateTest(test.id, { value: v, passed: null })}
                placeholder="expected"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
              />
            )}

            {/* remove */}
            <TouchableOpacity
              onPress={() => removeTest(test.id)}
              accessibilityLabel="remove this check"
            >
              <Icon name="close" size={14} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.addBtn} onPress={addTest}>
          <Text style={styles.addText}>+ Add Assertion</Text>
        </TouchableOpacity>

        {tests.length > 0 && response && (
          <TouchableOpacity style={styles.runBtn} onPress={runTests}>
            <Text style={styles.runText}>Re-run</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* quick test suggestions */}
      {tests.length === 0 && (
        <View style={styles.suggestions}>
          <Text style={styles.suggestTitle}>Quick Add:</Text>
          <TouchableOpacity
            style={styles.suggestBtn}
            onPress={() => {
              onChange([
                { id: "1", field: "status", operator: "equals", value: "200", passed: null },
              ]);
            }}
          >
            <Text style={styles.suggestText}>Status is 200</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.suggestBtn}
            onPress={() => {
              onChange([
                { id: "1", field: "status", operator: "equals", value: "200", passed: null },
                { id: "2", field: "data", operator: "exists", value: "", passed: null },
                { id: "3", field: "timing", operator: "less than", value: "1000", passed: null },
              ]);
            }}
          >
            <Text style={styles.suggestText}>Basic Health Check (status + data + timing)</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 11,
    marginLeft: 8,
    flex: 1,
  },
  summary: {
    flexDirection: "row",
    gap: 12,
  },
  summaryText: {
    fontSize: 12,
    fontWeight: "500",
  },
  testRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  indicator: {
    width: 20,
    alignItems: "center",
  },
  pending: {
    color: colors.textDim,
    fontSize: 14,
  },
  result: {
    fontSize: 14,
    fontWeight: "500",
  },
  fieldInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    fontFamily: "monospace",
    ...shadow.sm,
  },
  operatorBtn: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    ...shadow.sm,
  },
  operatorText: {
    color: colors.accent,
    fontSize: 11,
  },
  valueInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    fontFamily: "monospace",
    ...shadow.sm,
  },
  removeText: {
    color: colors.textDim,
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  addBtn: {
    paddingVertical: 6,
  },
  addText: {
    color: colors.accent,
    fontSize: 12,
  },
  runBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radius.md,
    ...shadow.sm,
  },
  runText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: "500",
  },
  suggestions: {
    marginTop: 16,
  },
  suggestTitle: {
    color: colors.textDim,
    fontSize: 12,
    marginBottom: 8,
  },
  suggestBtn: {
    backgroundColor: colors.surfaceLight,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    marginBottom: 6,
    ...shadow.sm,
  },
  suggestText: {
    color: colors.text,
    fontSize: 12,
  },
});
