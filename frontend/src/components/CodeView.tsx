import React from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { GeneratedEndpoint, ApplyOutcome, AppliedFile, VerifyResult } from "../types";
import VerificationPanel from "./VerificationPanel";
import { verdictLabel } from "../lib/verdict";
import { highlightLines } from "../lib/highlight";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  generated: GeneratedEndpoint | null;
  onClose: () => void;
  // the request tab that opened alongside this code, so the two halves of the
  // same answer are one click apart
  onOpenRequest: () => void;
  // opens the diff of what putting this code into the project would change.
  // the write itself is two approvals away from here, not one.
  onPreviewApply: () => void;
  // set once the code is in the files: the footer stops offering to put it there
  // again and reports what happened as one answer. Written, ran and worked is a
  // different thing from written and broken, and they must not look alike.
  applied: ApplyOutcome | null;
  // what was actually checked, so the verdict can show its working rather than
  // ask to be taken on trust
  evidence: { files: AppliedFile[]; result: VerifyResult | null } | null;
  onOpenExchange: (method: string, url: string) => void;
  // set while the change is being checked, so the wait has a way out. the files
  // are already written by then and stopping leaves them exactly as they are.
  verifying: boolean;
  onCancelVerify: () => void;
  // Every endpoint the agent has written code for that has not been dealt with
  // yet, and a way to move between them. Asked for two endpoints in one breath,
  // the agent writes two — and this panel used to open on whichever was written
  // last, with nothing on screen to say the other existed or how to reach it.
  pending: { key: string; method: string; path: string; applied: boolean }[];
  activeKey: string | null;
  onSelectPending: (key: string) => void;
}

// every layer's code in one block, with the file each part belongs to marked,
// because pasting three files back together from one clipboard is otherwise
// guesswork
function joinAll(generated: GeneratedEndpoint): string {
  return generated.layers
    .map((l) => `// ${"=".repeat(66)}\n// ${l.path}\n// ${"=".repeat(66)}\n\n${l.code}`)
    .join("\n\n");
}

// The layers a project turned out not to have. Saying so is the difference
// between "we looked and there is no controller here" and a reader assuming a
// controller was quietly forgotten. Nothing is generated for these, because a
// layer the project does not use is one the developer would have to delete.
const STANDARD_LAYERS = ["router", "controller", "service"];

function describeGap(missing: string[]): string {
  const named =
    missing.length === 1
      ? `${missing[0]} layer`
      : `${missing.slice(0, -1).join(", ")} or ${missing[missing.length - 1]} layers`;
  return `no ${named} in this project, so none was invented`;
}

export default function CodeView({
  visible,
  generated,
  onClose,
  onOpenRequest,
  onPreviewApply,
  applied,
  evidence,
  onOpenExchange,
  verifying,
  onCancelVerify,
  pending,
  activeKey,
  onSelectPending,
}: Props) {
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

  const missing = React.useMemo(() => {
    if (!generated) return [];
    const found = new Set(generated.references.map((r) => r.layer));
    return STANDARD_LAYERS.filter((l) => !found.has(l));
  }, [generated]);

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
              accessibilityLabel="close the generated code"
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
              onPress={onClose}
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          {/* Asked for two endpoints at once, the agent writes two — and this
              panel opened on whichever was written last, with nothing to say the
              other existed. The code was never lost; it was unreachable, which
              from where the developer sits is the same thing. */}
          {pending.length > 1 && (
            <View style={styles.pendingRow}>
              {pending.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => onSelectPending(p.key)}
                  style={({ hovered }: any) => [
                    styles.pendingItem,
                    p.key === activeKey && styles.pendingItemOn,
                    hovered && p.key !== activeKey && styles.pendingItemHover,
                  ]}
                  accessibilityLabel={`show the code for ${p.method} ${p.path}`}
                >
                  {/* a dot for the ones already in the project, so "which of
                      these have I dealt with" is answered without opening each */}
                  <View
                    style={[
                      styles.pendingDot,
                      { backgroundColor: p.applied ? colors.statusOk : colors.warning },
                    ]}
                  />
                  <Text
                    style={[
                      styles.pendingText,
                      p.key === activeKey && styles.pendingTextOn,
                    ]}
                    numberOfLines={1}
                  >
                    {p.method} {p.path}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {!!generated.summary && <Text style={styles.summary}>{generated.summary}</Text>}

          {/* the claim is "this matches your project". naming the files it was
              read from is what makes that checkable rather than a slogan */}
          {generated.references.length > 0 && (
            <Text style={styles.provenance} numberOfLines={2}>
              style read from {generated.references.map((r) => r.path).join(", ")}
            </Text>
          )}

          {/* a project with two layers gets two tabs, and without this line
              that reads as a third one having gone missing */}
          {missing.length > 0 && <Text style={styles.gap}>{describeGap(missing)}</Text>}

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

          {/* The argument, not the claim. It sits above the footer because it is
              the answer to what the developer just asked for, and the buttons
              underneath are what they might do next. */}
          {!!applied && (
            <VerificationPanel
              outcome={applied}
              files={evidence?.files || []}
              result={evidence?.result || null}
              onOpenRequest={onOpenExchange}
            />
          )}

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
            {/* Stated plainly and never softened. It used to say the files
                would never be touched; now they can be, so what has to stay
                unambiguous is that reading the diff comes first. */}
            {/* the verdict and its working are in the panel above; the footer
                keeps the one promise that has to hold before any of it */}
            <Text style={styles.disclaimer} numberOfLines={2}>
              {applied ? applied.text : "Nothing is written until you have read the diff."}
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
            {/* copying is still a perfectly good way to use this, so it keeps a
                button of its own rather than being replaced by the write */}
            <Pressable
              style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
              onPress={() => layer && copy(layer.code, "one")}
            >
              <Text style={styles.btnText}>
                {copied === "one"
                  ? "copied"
                  : copied === "failed"
                  ? "copy failed"
                  : `Copy ${layer?.layer ?? "file"}`}
              </Text>
            </Pressable>
            {/* the wait can be a server starting from cold, so it gets a way
                out. it stops the checking, never the change. */}
            {verifying && (
              <Pressable
                style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
                onPress={onCancelVerify}
                accessibilityLabel="stop checking this change"
              >
                <Text style={styles.btnText}>Stop checking</Text>
              </Pressable>
            )}
            <Pressable
              disabled={!!applied}
              style={({ hovered }: any) => [
                styles.btnPrimary,
                hovered && styles.btnPrimaryHover,
                !!applied && styles.btnDisabled,
              ]}
              onPress={onPreviewApply}
            >
              <Icon name="arrowRight" size={13} color={colors.bg} />
              {/* not "Applied": that is the half of the answer that is never in
                  doubt, and the half that is in doubt is the one worth saying */}
              <Text style={styles.btnPrimaryText}>
                {!applied ? "Review changes" : verdictLabel(applied.verdict)}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pendingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 10,
  },
  pendingItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 320,
    ...transition("background-color"),
  },
  pendingItemHover: { backgroundColor: colors.hover },
  pendingItemOn: { backgroundColor: colors.surfaceLight, borderColor: colors.textDim },
  pendingDot: { width: 5, height: 5, borderRadius: 3 },
  pendingText: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
  pendingTextOn: { color: colors.text },
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
  gap: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 3,
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
  outcomeOk: {
    color: colors.statusOk,
  },
  outcomeBad: {
    color: colors.statusErr,
  },
  outcomeUnsure: {
    color: colors.warning,
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
  btnDisabled: {
    opacity: 0.45,
  },
  btnPrimaryText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: "500",
  },
});
