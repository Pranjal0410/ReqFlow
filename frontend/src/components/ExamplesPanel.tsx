import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { Example, ExampleLimit, describeAge, REDACTED } from "../lib/examples";
import JsonView from "./JsonView";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  examples: Example[];
  limit: ExampleLimit;
  onClose: () => void;
  onLimitChange: (limit: ExampleLimit) => void;
  // puts this example's request back into the tab. the response is not
  // restored with it: see the note below.
  onRestore: (example: Example) => void;
}

// Runs of this endpoint that were kept without being asked for. The app used to
// persist no responses at all, on the grounds that a stored one sitting where a
// live one goes reads as the current answer — so an example is shown here, dated
// and labelled, and never poured back into the response viewer. Restoring one
// puts its request into the tab and leaves the sending to the developer.
export default function ExamplesPanel({
  visible,
  examples,
  limit,
  onClose,
  onLimitChange,
  onRestore,
}: Props) {
  const [active, setActive] = React.useState(0);
  const now = Date.now();

  React.useEffect(() => {
    setActive(0);
  }, [examples.length, visible]);

  const example = examples[active] ?? null;

  const statusColor = (status: number) =>
    status >= 200 && status < 300 ? colors.statusOk : colors.statusErr;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>Previous runs</Text>
            <View style={{ flex: 1 }} />
            {/* the setting lives here because here is where it means something */}
            <View style={styles.limitRow}>
              <Text style={styles.limitLabel}>keep</Text>
              {([3, 5] as ExampleLimit[]).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => onLimitChange(n)}
                  style={({ hovered }: any) => [
                    styles.limitBtn,
                    limit === n && styles.limitBtnOn,
                    hovered && limit !== n && styles.limitBtnHover,
                  ]}
                >
                  <Text style={[styles.limitText, limit === n && styles.limitTextOn]}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityLabel="close previous runs"
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
              onPress={onClose}
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          {examples.length === 0 ? (
            <Text style={styles.empty}>
              Nothing on file for this endpoint yet. Every send is kept from now on.
            </Text>
          ) : (
            <>
              <View style={styles.runs}>
                {examples.map((e, i) => (
                  <Pressable
                    key={e.id}
                    onPress={() => setActive(i)}
                    style={({ hovered }: any) => [
                      styles.run,
                      i === active && styles.runActive,
                      hovered && i !== active && styles.runHover,
                    ]}
                  >
                    <Text style={[styles.runStatus, { color: statusColor(e.response.status) }]}>
                      {e.response.status}
                    </Text>
                    <Text style={styles.runAge}>{describeAge(e.at, now)}</Text>
                    <Text style={styles.runTiming}>{e.response.timing.total}ms</Text>
                  </Pressable>
                ))}
              </View>

              {!!example && (
                <ScrollView style={styles.body} nestedScrollEnabled>
                  <Text style={styles.sectionTitle}>Sent</Text>
                  <Text style={styles.mono} numberOfLines={2}>
                    {example.method} {example.url}
                  </Text>

                  {Object.keys(example.headers).length > 0 && (
                    <View style={styles.headers}>
                      {Object.entries(example.headers).map(([k, v]) => (
                        <Text key={k} style={styles.headerLine} numberOfLines={1}>
                          <Text style={styles.headerKey}>{k}: </Text>
                          <Text style={v === REDACTED ? styles.redacted : undefined}>{v}</Text>
                        </Text>
                      ))}
                    </View>
                  )}

                  {!!example.body.trim() && (
                    <View style={styles.block}>
                      <Text style={styles.mono}>{example.body}</Text>
                    </View>
                  )}

                  <Text style={styles.sectionTitle}>Came back</Text>
                  <View style={styles.block}>
                    <JsonView data={example.response.data} />
                  </View>
                </ScrollView>
              )}
            </>
          )}

          <View style={styles.footer}>
            {/* the one line that keeps this honest: an example is a record of
                something that happened then, not an answer about now */}
            <Text style={styles.note} numberOfLines={2}>
              {example
                ? `Captured ${describeAge(example.at, now)}. Credentials were removed before saving.`
                : ""}
            </Text>
            <Pressable
              disabled={!example}
              style={({ hovered }: any) => [
                styles.btn,
                hovered && styles.btnHover,
                !example && styles.btnDisabled,
              ]}
              onPress={() => example && onRestore(example)}
            >
              <Text style={styles.btnText}>Put this request back</Text>
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
    maxWidth: 720,
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
  limitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  limitLabel: {
    color: colors.textDim,
    fontSize: 11,
    marginRight: 3,
  },
  limitBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  limitBtnHover: {
    backgroundColor: colors.hover,
  },
  limitBtnOn: {
    backgroundColor: colors.surfaceLight,
  },
  limitText: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
  limitTextOn: {
    color: colors.text,
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
  empty: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 19,
    paddingVertical: 18,
  },
  runs: {
    flexDirection: "row",
    gap: 4,
    marginTop: 14,
    flexWrap: "wrap",
  },
  run: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  runHover: {
    backgroundColor: colors.hover,
  },
  runActive: {
    backgroundColor: colors.surfaceLight,
  },
  runStatus: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "600",
  },
  runAge: {
    color: colors.textMuted,
    fontSize: 11,
  },
  runTiming: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: "monospace",
  },
  body: {
    marginTop: 14,
    flexGrow: 0,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 5,
    marginTop: 10,
  },
  mono: {
    color: colors.text,
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
  headers: {
    marginTop: 6,
    gap: 2,
  },
  headerLine: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: "monospace",
  },
  headerKey: {
    color: colors.textDim,
  },
  redacted: {
    color: colors.textDim,
    fontStyle: "italic",
  },
  block: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 10,
    marginTop: 6,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  note: {
    flex: 1,
    color: colors.textDim,
    fontSize: 11,
  },
  btn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...transition("background-color"),
  },
  btnHover: {
    backgroundColor: colors.hover,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
