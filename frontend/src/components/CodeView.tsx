import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { GeneratedEndpoint } from "../types";
import { highlightLines } from "../lib/highlight";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  generated: GeneratedEndpoint | null;
  onClose: () => void;
  // the request tab that opened alongside this code, so the two halves of the
  // same answer are one click apart
  onOpenRequest: () => void;
}

// every layer's code in one block, with the file each part belongs to marked,
// because pasting three files back together from one clipboard is otherwise
// guesswork
function joinAll(generated: GeneratedEndpoint): string {
  return generated.layers
    .map((l) => `// ${"=".repeat(66)}\n// ${l.path}\n// ${"=".repeat(66)}\n\n${l.code}`)
    .join("\n\n");
}

export default function CodeView({ visible, generated, onClose, onOpenRequest }: Props) {
  const [active, setActive] = React.useState(0);
  const [copied, setCopied] = React.useState<string | null>(null);

  // a second generation replaces the first, and leaving the old tab index
  // selected would show layer three of an answer that has two
  React.useEffect(() => {
    setActive(0);
    setCopied(null);
  }, [generated]);

  const layer = generated?.layers[active] ?? null;

  const lines = React.useMemo(
    () => (layer ? highlightLines(layer.code) : []),
    [layer]
  );

  const copy = async (text: string, label: string) => {
    // a browser can refuse the clipboard, and reporting "copied" when nothing
    // was copied is how someone pastes the last thing they had instead
    try {
      await Clipboard.setStringAsync(text);
      setCopied(label);
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 1600);
  };

  if (!generated) return null;

  const methodColor =
    (colors.method as Record<string, string>)[generated.method] || colors.textMuted;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={[styles.method, { color: methodColor }]}>{generated.method}</Text>
            <Text style={styles.path} numberOfLines={1}>
              {generated.path}
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
              onPress={onClose}
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          {!!generated.summary && <Text style={styles.summary}>{generated.summary}</Text>}

          {/* the claim is "this matches your project". naming the files it was
              read from is what makes that checkable rather than a slogan */}
          {generated.references.length > 0 && (
            <Text style={styles.provenance} numberOfLines={2}>
              style read from {generated.references.map((r) => r.path).join(", ")}
            </Text>
          )}

          <View style={styles.tabs}>
            {generated.layers.map((l, i) => (
              <Pressable
                key={`${l.layer}-${i}`}
                onPress={() => setActive(i)}
                style={({ hovered }: any) => [
                  styles.tab,
                  i === active && styles.tabActive,
                  hovered && i !== active && styles.tabHover,
                ]}
              >
                <Text style={[styles.tabText, i === active && styles.tabTextActive]}>
                  {l.layer}
                </Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            {!!layer && (
              <Text style={styles.filePath} numberOfLines={1}>
                {layer.path}
              </Text>
            )}
          </View>

          <ScrollView style={styles.codeWrap} nestedScrollEnabled>
            <View style={styles.codeRow}>
              <View style={styles.gutter}>
                {lines.map((_, i) => (
                  <Text key={i} style={styles.lineNo}>
                    {i + 1}
                  </Text>
                ))}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                <View>
                  {lines.map((tokens, i) => (
                    <Text key={i} style={styles.line}>
                      {tokens.length === 0 ? (
                        " "
                      ) : (
                        tokens.map((t, j) => (
                          <Text key={j} style={{ color: t.color }}>
                            {t.text}
                          </Text>
                        ))
                      )}
                    </Text>
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>

          {generated.notes.length > 0 && (
            <View style={styles.notes}>
              {generated.notes.map((n, i) => (
                <Text key={i} style={styles.note}>
                  — {n}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.footer}>
            {/* stated plainly and never softened: the whole reason this is a
                viewer and not an editor */}
            <Text style={styles.disclaimer} numberOfLines={2}>
              Nothing was written to your files. Copy what you want.
            </Text>
            <Pressable
              style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
              onPress={onOpenRequest}
            >
              <Text style={styles.btnText}>Open request tab</Text>
            </Pressable>
            <Pressable
              style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
              onPress={() => copy(joinAll(generated), "all")}
            >
              <Text style={styles.btnText}>
                {copied === "all" ? "copied" : copied === "failed" ? "copy failed" : "Copy all"}
              </Text>
            </Pressable>
            <Pressable
              style={({ hovered }: any) => [styles.btnPrimary, hovered && styles.btnPrimaryHover]}
              onPress={() => layer && copy(layer.code, "one")}
            >
              <Icon name="copy" size={13} color={colors.bg} />
              <Text style={styles.btnPrimaryText}>
                {copied === "one"
                  ? "copied"
                  : copied === "failed"
                  ? "copy failed"
                  : `Copy ${layer?.layer ?? "file"}`}
              </Text>
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
    maxWidth: 940,
    maxHeight: "92%",
    ...shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  method: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  path: {
    color: colors.text,
    fontSize: 15,
    fontFamily: "monospace",
    flexShrink: 1,
  },
  iconBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  iconBtnHover: {
    backgroundColor: colors.hover,
  },
  summary: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  provenance: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 6,
  },
  tabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 14,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  tabHover: {
    backgroundColor: colors.hover,
  },
  tabActive: {
    backgroundColor: colors.surfaceLight,
  },
  tabText: {
    color: colors.textDim,
    fontSize: 12,
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: "500",
  },
  filePath: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    flexShrink: 1,
    marginLeft: 12,
  },
  codeWrap: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 12,
    flexGrow: 0,
  },
  codeRow: {
    flexDirection: "row",
    gap: 12,
  },
  gutter: {
    alignItems: "flex-end",
    // narrow but fixed, so the code does not shift left as the line count
    // crosses from single to double digits
    minWidth: 22,
  },
  lineNo: {
    color: colors.syntax.comment,
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 19,
  },
  line: {
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 19,
  },
  notes: {
    marginTop: 10,
    gap: 3,
  },
  note: {
    color: colors.warning,
    fontSize: 11,
    lineHeight: 17,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  disclaimer: {
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
  btnText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...shadow.sm,
    ...transition("opacity"),
  },
  btnPrimaryHover: {
    opacity: 0.88,
  },
  btnPrimaryText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: "500",
  },
});
