import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, transition } from "../theme/tokens";
import { ApplyOutcome, VerifyResult, AppliedFile } from "../types";
import Icon from "./Icon";
import { verdictLabel } from "../lib/verdict";

interface Props {
  outcome: ApplyOutcome;
  files: AppliedFile[];
  result: VerifyResult | null;
  onOpenRequest: (method: string, url: string) => void;
}

// What was actually checked, line by line.
//
// The verdict on its own is a claim; this is the working. It exists because the
// product's whole argument is "I can tell you whether it worked", and a single
// sentence asks the developer to take that on trust — which is the habit this is
// supposed to break.
//
// Nothing here is inferred. Every line is something the backend measured: the
// files it wrote, the wait it timed, the requests it sent and the statuses that
// came back.
function Line({
  state,
  children,
}: {
  state: "ok" | "bad" | "info";
  children: React.ReactNode;
}) {
  const color =
    state === "ok" ? colors.statusOk : state === "bad" ? colors.statusErr : colors.textDim;

  return (
    <View style={styles.line}>
      {/* the mark and the wording both carry it, so the state does not depend on
          seeing a colour */}
      <Icon
        name={state === "ok" ? "check" : state === "bad" ? "x" : "circle"}
        size={12}
        color={color}
      />
      <Text style={[styles.lineText, state === "bad" && { color: colors.text }]}>{children}</Text>
    </View>
  );
}

export default function VerificationPanel({ outcome, files, result, onOpenRequest }: Props) {
  const [open, setOpen] = React.useState(outcome.verdict !== "verified");

  const heading = verdictLabel(outcome.verdict);

  const tone =
    outcome.verdict === "verified"
      ? colors.statusOk
      : outcome.verdict === "failed"
      ? colors.statusErr
      : colors.warning;

  const exchanges = [result?.create, result?.read].filter(Boolean);

  return (
    <View style={[styles.panel, { borderColor: tone }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.header}
        accessibilityLabel={`${heading}. ${open ? "hide" : "show"} what was checked`}
      >
        <Icon
          name={outcome.verdict === "verified" ? "check" : "alert"}
          size={14}
          color={tone}
        />
        <Text style={[styles.heading, { color: tone }]}>{heading}</Text>
        <View style={{ flex: 1 }} />
        <Icon name={open ? "chevronDown" : "chevronRight"} size={13} color={colors.textDim} />
      </Pressable>

      {open && (
        <View style={styles.body}>
          {files.map((f) => (
            <Line key={f.relPath} state="ok">
              {f.relPath} — {f.isNew ? "new file" : `+${f.addedLines} lines`}
              {f.backup ? ` · backed up to ${f.backup}` : ""}
            </Line>
          ))}

          {result?.ownership === "started" && (
            <Line state="ok">ReqFlow started your server</Line>
          )}
          {result?.ownership === "restarted" && (
            <Line state="ok">ReqFlow restarted the server it started</Line>
          )}
          {result?.ownership === "existing" && (
            // A tick, not a neutral mark. Checking against the server the
            // developer is already running is one of the three ways this
            // succeeds, not a caveat about the other two — and ReqFlow leaving
            // their process alone is the behaviour, not a shortfall of it.
            <Line state="ok">checked against the server you were already running</Line>
          )}

          {result?.ready && (
            <Line state="ok">
              server answered in {((result.waitedMs || 0) / 1000).toFixed(1)}s
            </Line>
          )}
          {result && !result.ready && (
            <Line state={result.brokeServer ? "bad" : "info"}>
              {result.brokeServer
                ? "the server stopped after the write"
                : "nothing was listening, so it could not be checked"}
            </Line>
          )}

          {exchanges.map((c) => (
            <Pressable
              key={c!.url + c!.method}
              onPress={() => onOpenRequest(c!.method, c!.url)}
              style={({ hovered }: any) => [styles.exchange, hovered && styles.exchangeHover]}
              accessibilityLabel={`open the ${c!.method} request in a tab`}
            >
              <Line state={c!.response.status < 400 ? "ok" : "bad"}>
                {c!.method} {c!.url.replace(/^https?:\/\/[^/]+/, "")} → {c!.response.status}{" "}
                {c!.response.statusText}
              </Line>
            </Pressable>
          ))}

          {/* the sentence the backend wrote, kept when it says something the
              lines above cannot */}
          {!!result?.message && <Text style={styles.note}>{result.message}</Text>}

          {outcome.verdict !== "verified" && (
            <Text style={styles.next}>
              {/* The same sentence used to appear under every failure, including
                  the ones that are not failures — an endpoint answering 409 on a
                  record that is genuinely already resolved has done what it was
                  asked. When the backend can say something specific about this
                  status, it says that instead. */}
              {result?.nextStep ||
                "The change is in your files and nothing was undone. Read your server's output, fix it, or undo with git."}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    marginTop: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  heading: { fontSize: 12, fontWeight: "500" },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 11,
    gap: 5,
  },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  lineText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "monospace",
  },
  exchange: {
    borderRadius: radius.sm,
    marginHorizontal: -4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    ...transition("background-color"),
  },
  exchangeHover: { backgroundColor: colors.hover },
  note: { color: colors.textDim, fontSize: 11, lineHeight: 17, marginTop: 4 },
  next: { color: colors.warning, fontSize: 11, lineHeight: 17, marginTop: 4 },
});
