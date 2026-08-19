import React from "react";
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { ApplyPlan, FilePlan } from "../types";
import { highlightLines } from "../lib/highlight";
import Icon from "./Icon";

interface Props {
  visible: boolean;
  plan: ApplyPlan | null;
  // the plan is fetched when this opens, so the panel has a waiting state of
  // its own rather than the code view appearing to hang
  loading: boolean;
  error: string | null;
  // Offered only when the write was refused for want of permission, and only in
  // the desktop app. Choosing the folder is the act that grants access to it on
  // macOS, so the way out of this failure is a dialog rather than a trip to
  // System Settings.
  onChooseFolder: (() => void) | null;
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
}

// What a file gets, said in the file's own terms. "inserted above line 34" is
// checkable against the file on screen; "modified" is not.
function describePlacement(file: FilePlan): string {
  if (file.isNew) return "new file";

  // Applying the same endpoint again takes the old declaration out and puts the
  // new one in its place. Code leaving the developer's file has to be as visible
  // as code arriving in it — a diff that only ever counts additions is not a
  // diff, and this is the one line they read before saying yes.
  const gone = file.replaced?.length
    ? `, replacing ${file.replaced.join(", ")}`
    : "";

  if (file.insertAbove === null) return `appended, +${file.addedLines} lines${gone}`;
  return `above line ${file.insertAbove}, +${file.addedLines} lines${gone}`;
}

function DirtyWarning({ dirty }: { dirty: string[] }) {
  // Not a refusal. The developer having work in progress is normal; what is not
  // normal is our write landing in the middle of it without them knowing, and
  // then being indistinguishable from their own changes in the next diff.
  const shown = dirty.slice(0, 4);
  const rest = dirty.length - shown.length;

  return (
    <View style={styles.warning}>
      <Icon name="alert" size={13} color={colors.warning} />
      <Text style={styles.warningText}>
        This repo has {dirty.length} uncommitted change{dirty.length === 1 ? "" : "s"} —{" "}
        {shown.join(", ")}
        {rest > 0 ? ` and ${rest} more` : ""}. Committing first keeps what ReqFlow writes
        separate from your own work.
      </Text>
    </View>
  );
}

export default function ApplyPreview({
  visible,
  plan,
  loading,
  error,
  onChooseFolder,
  applying,
  onCancel,
  onApply,
}: Props) {
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    setActive(0);
  }, [plan]);

  const file = plan?.files[active] ?? null;
  const lines = React.useMemo(() => (file ? highlightLines(file.code) : []), [file]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>Changes to your project</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityLabel="close without applying"
              style={({ hovered }: any) => [styles.iconBtn, hovered && styles.iconBtnHover]}
              onPress={onCancel}
            >
              <Icon name="close" size={15} color={colors.textDim} />
            </Pressable>
          </View>

          {loading && (
            <View style={styles.centred}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.waiting}>reading the files this would touch</Text>
            </View>
          )}

          {!!error && !loading && !!onChooseFolder && (
            <View style={styles.recover}>
              <Text style={styles.error}>{error}</Text>
              <Pressable
                onPress={onChooseFolder}
                style={({ hovered }: any) => [styles.recoverBtn, hovered && styles.recoverBtnHover]}
              >
                <Text style={styles.recoverText}>Choose the folder</Text>
              </Pressable>
            </View>
          )}

          {!!error && !loading && !onChooseFolder && (
            <View style={styles.centred}>
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          {!!plan && !loading && !error && (
            <>
              <View style={styles.fileList}>
                {plan.files.map((f, i) => (
                  <Pressable
                    key={f.relPath}
                    onPress={() => setActive(i)}
                    style={({ hovered }: any) => [
                      styles.fileRow,
                      i === active && styles.fileRowActive,
                      hovered && i !== active && styles.fileRowHover,
                    ]}
                  >
                    <Text
                      style={[styles.filePath, i === active && styles.filePathActive]}
                      numberOfLines={1}
                    >
                      {f.relPath}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.placement, f.isNew && styles.placementNew]}>
                      {describePlacement(f)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {plan.git.dirty.length > 0 && <DirtyWarning dirty={plan.git.dirty} />}

              {/* Said before the write, because after it the same information
                  arrives as a 500 from a server that will not tell you which
                  line caused it. Three real failures had this shape and none of
                  them was a syntax error, so nothing else catches them here. */}
              {plan.files.some((f) => f.undefinedNames?.length) && (
                <View style={styles.warning}>
                  <Icon name="alert" size={13} color={colors.warning} />
                  <Text style={styles.warningText}>
                    {plan.files
                      .filter((f) => f.undefinedNames?.length)
                      .map(
                        (f) =>
                          `${f.relPath} uses ${f.undefinedNames.join(", ")}, which nothing in it defines`
                      )
                      .join(". ")}
                    . It will still be written if you apply it — this is a warning, and running
                    the endpoint afterwards is what settles it.
                  </Text>
                </View>
              )}

              {/* The one failure the runtime check cannot explain. Express
                  matches in registration order, and applied code lands below
                  what the file already has — so a new GET /stats under an
                  existing GET /:id is never reached, and every request for it is
                  answered by /:id with id="stats". The file parses, the server
                  boots, and the endpoint returns someone else's error. Verifying
                  it afterwards sees a real response with a wrong status and
                  cannot say why, which is exactly why this is said beforehand. */}
              {plan.files.some((f) => f.shadowed?.length) && (
                <View style={styles.warning}>
                  <Icon name="alert" size={13} color={colors.warning} />
                  <Text style={styles.warningText}>
                    {plan.files
                      .flatMap((f) => (f.shadowed || []).map((w) => ({ ...w, file: f.relPath })))
                      .map(
                        (w) =>
                          `${w.route} would never be reached: ${w.by} is registered above it at ${w.file}:${w.line} and matches first`
                      )
                      .join(". ")}
                    . Move it above that route, or give it a path that route cannot match.
                  </Text>
                </View>
              )}

              {/* said before the write, not after: a developer who wants git to
                  be their undo needs to know now that it will not be */}
              {!plan.git.repo && (
                <Text style={styles.note}>
                  Not a git repository, so each file that already exists is copied to
                  .reqflow.bak before it is changed.
                </Text>
              )}

              <ScrollView style={styles.codeWrap} nestedScrollEnabled>
                <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                  <View>
                    {lines.map((tokens, i) => (
                      <View key={i} style={styles.addedLine}>
                        <Text style={styles.marker}>+</Text>
                        <Text style={styles.line}>
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
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </ScrollView>
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.summary} numberOfLines={2}>
              {plan
                ? `${plan.files.length} file${plan.files.length === 1 ? "" : "s"}. Nothing is written until you press Apply.`
                : ""}
            </Text>
            <Pressable
              style={({ hovered }: any) => [styles.btn, hovered && styles.btnHover]}
              onPress={onCancel}
            >
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!plan || applying || !!error}
              style={({ hovered }: any) => [
                styles.btnPrimary,
                hovered && styles.btnPrimaryHover,
                (!plan || applying || !!error) && styles.btnDisabled,
              ]}
              onPress={onApply}
            >
              <Text style={styles.btnPrimaryText}>
                {applying ? "writing…" : "Apply to project"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  recover: {
    gap: 10,
    alignItems: "flex-start",
    paddingVertical: 18,
  },
  recoverBtn: {
    borderWidth: 1,
    borderColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...transition("background-color"),
  },
  recoverBtnHover: { backgroundColor: colors.hover },
  recoverText: { color: colors.text, fontSize: 12, fontWeight: "500" },
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
    maxWidth: 860,
    maxHeight: "92%",
    ...shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
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
  centred: {
    paddingVertical: 36,
    alignItems: "center",
    gap: 10,
  },
  waiting: {
    color: colors.textDim,
    fontSize: 12,
  },
  error: {
    color: colors.statusErr,
    fontSize: 12,
    textAlign: "center",
  },
  fileList: {
    gap: 2,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  fileRowHover: {
    backgroundColor: colors.hover,
  },
  fileRowActive: {
    backgroundColor: colors.surfaceLight,
  },
  filePath: {
    color: colors.textDim,
    fontSize: 12,
    fontFamily: "monospace",
    flexShrink: 1,
  },
  filePathActive: {
    color: colors.text,
  },
  placement: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
  placementNew: {
    color: colors.statusOk,
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 10,
  },
  warningText: {
    flex: 1,
    color: colors.warning,
    fontSize: 11,
    lineHeight: 17,
  },
  note: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
  codeWrap: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
    flexGrow: 0,
  },
  addedLine: {
    flexDirection: "row",
    gap: 10,
  },
  marker: {
    color: colors.statusOk,
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 19,
  },
  line: {
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 19,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  summary: {
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
