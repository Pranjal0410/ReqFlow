import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { DetectedRoute, ApiResponse, GeneratedEndpoint } from "../types";
import { CONFIG } from "../config";
import Icon from "./Icon";
import { cancelRun } from "../services/api";
import JsonView from "./JsonView";

// the line shown while a run is under way, built from the last thing it did
function describeAction(a: ActionLogEntry | undefined): string | null {
  if (!a) return null;
  const short = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");
  if (a.kind === "request") {
    return `${a.refused ? "blocked" : "testing"} ${a.method} ${short(a.url)}`;
  }
  if (a.kind === "draft") return `drafting ${a.method} ${short(a.url)}`;
  if (a.kind === "assertions") return `writing ${a.count} assertion${a.count === 1 ? "" : "s"}`;
  if (a.kind === "code") return `writing ${a.method} ${a.path}`;
  if (a.kind === "instruction") return "saving an instruction";
  return `saving {{${a.name}}}`;
}

// the agent acts without asking, so this log is how the user knows what it did.
// sent and drafted stay distinguishable: a drafted tab went nowhere.
type ActionLogEntry =
  | {
      kind: "request";
      method: string;
      url: string;
      status: number | null;
      refused: boolean;
      requestHeaders?: Record<string, string>;
      requestBody?: string;
      response?: ApiResponse & { truncated?: boolean };
    }
  | { kind: "draft"; method: string; url: string }
  | { kind: "assertions"; count: number }
  | { kind: "variable"; name: string }
  | { kind: "code"; method: string; path: string; layers: number }
  | { kind: "instruction"; text: string };

// a request the agent already ran. it goes straight into a tab so the response
// lands in the full width viewer, instead of being readable only in the chat
// column the agent happens to live in.
export interface AgentSentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  response: ApiResponse;
}

interface Message {
  id: string;
  role: "assistant" | "user";
  content: string;
  trace?: ActionLogEntry[];
}

export interface AgentRequestDraft {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  label: string;
}

export interface AgentAssertion {
  field: string;
  operator: string;
  value: string;
}

// what the user is actually looking at. without it the agent cannot answer
// "why is this failing", the most obvious question there is, because it has
// never seen the request or the response on screen.
export interface ActiveTabContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  response: {
    status: number;
    statusText: string;
    timing: number;
    data: string;
  } | null;
  tests: { field: string; operator: string; value: string; passed: boolean | null }[];
}

interface Props {
  routes: DetectedRoute[];
  onSelectRoute?: (route: DetectedRoute) => void;
  visible: boolean;
  onClose: () => void;
  baseUrl: string;
  activeTab: ActiveTabContext;
  onCreateRequest: (draft: AgentRequestDraft) => void;
  onCreateAssertions: (assertions: AgentAssertion[]) => void;
  onAgentRequests: (sent: AgentSentRequest[]) => void;
  onSetVariable: (name: string, value: string) => void;
  // jump to the tab a logged request opened, so the chat can point at the
  // main screen instead of being the only place the result is readable
  onFocusRequest: (method: string, url: string) => void;
  variables: Record<string, string>;
  // the folder the last scan read. generated code is written in the style of
  // what is in it, so without one there is nothing to imitate.
  projectPath: string | null;
  onGeneratedCode: (generated: GeneratedEndpoint) => void;
  // standing rules switched on in the workspace, sent with every call
  instructions: { id: string; text: string }[];
  onRememberInstruction: (text: string) => void;
  // ids the backend reported having used, so the panel shows what was really
  // sent instead of what the frontend meant to send
  onInstructionsSent: (ids: string[]) => void;
  // reopens the code view for a generation further up the conversation
  onShowCode: () => void;
}

export default function AiAgent({
  routes,
  visible,
  onClose,
  baseUrl,
  activeTab,
  onCreateRequest,
  onCreateAssertions,
  onAgentRequests,
  onSetVariable,
  onFocusRequest,
  variables,
  projectPath,
  onGeneratedCode,
  onShowCode,
  instructions,
  onRememberInstruction,
  onInstructionsSent,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        // The first thing anyone reads. It used to be two paragraphs and a
        // five-item list, which in the first thirty seconds is a wall rather
        // than an answer. What it has to say is what this can do and what
        // makes it different — the limits are true but they are not the
        // opening line.
        "Ask me to write an endpoint your project does not have, or to test the ones it does.\n\nWhen I write one you get the code, a diff of every line it would change, and — once you apply it — ReqFlow runs the endpoint and tells you whether it actually worked.\n\nI act without checking in first, and everything I do is logged under each reply.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // the id of the run in flight, so the Stop above can name it. a ref because
  // the button reads it at press time rather than at render time.
  const runIdRef = React.useRef("");
  // autonomous by default. read-only is here for when you want it, not the
  // starting position.
  const [allowWrites, setAllowWrites] = useState(true);
  const [actionsUsed, setActionsUsed] = useState(0);
  const [actionLimit, setActionLimit] = useState(30);
  // which response in the log is open. one at a time keeps the panel readable.
  const [expanded, setExpanded] = useState<string | null>(null);
  // what the agent is doing right now. a run of a dozen endpoints took a minute
  // behind a spinner that said nothing about which one it was on.
  const [progress, setProgress] = useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);

  if (!visible) return null;

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setProgress(null);

    const runId = `${Date.now()}${Math.random().toString(36).slice(2)}`;
    runIdRef.current = runId;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${CONFIG.API_BASE}/ai-chat/progress/${runId}`);
        const { actions, note } = await r.json();
        // a tool still running says so itself; otherwise the last thing that
        // finished is the best account of where the run is
        setProgress(note || describeAction(actions?.[actions.length - 1]));
      } catch {
        // the run's own request carries the real errors; a missed poll is noise
      }
    }, 700);

    try {
      // build context about detected routes
      // the scan already worked out what each endpoint expects. sending only
      // the method and path left the agent to invent field names, so a POST
      // came back 400 for a body the scan could have supplied.
      const routeContext = routes.length > 0
        ? `\n\nDetected API endpoints in the current project:\n${routes
            .map((r) => {
              const lines = [`${r.method} ${r.path} - ${r.description}`];
              if (r.params && r.params.length) {
                lines.push(`  params: ${r.params.join(", ")}`);
              }
              if (r.body) {
                lines.push(`  body: ${JSON.stringify(r.body)}`);
              }
              return lines.join("\n");
            })
            .join("\n")}`
        : "\n\nNo project has been scanned yet.";

      // The longest request the app makes, and the one with no way out if it
      // hangs: the panel would spin on "thinking" forever. Bounded well past a
      // real generation, so a slow model still finishes and a dead backend does
      // not leave the developer waiting on nothing.
      const stopWaiting = new AbortController();
      const gaveUp = setTimeout(() => stopWaiting.abort(), 180_000);

      const res = await fetch(`${CONFIG.API_BASE}/ai-chat`, {
        signal: stopWaiting.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          routeContext,
          baseUrl,
          projectPath,
          allowWrites,
          actionsUsed,
          runId,
          activeTab,
          variables,
          instructions,
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      clearTimeout(gaveUp);
      const data = await res.json();

      // everything the agent sent becomes a tab with its response already in
      // it. this runs before the ui actions so that assertions asked for in the
      // same breath land on the tab the user is now looking at.
      const sent: AgentSentRequest[] = (data.trace || [])
        .filter((t: ActionLogEntry) => t.kind === "request" && t.response)
        .map((t: any) => ({
          method: t.method,
          url: t.url,
          headers: t.requestHeaders || {},
          body: t.requestBody || "",
          response: t.response,
        }));
      if (sent.length) onAgentRequests(sent);

      // the agent decided on these, but only the app can carry them out. apply
      // them before the reply lands so the message and the tabs agree.
      for (const action of data.uiActions || []) {
        if (action.type === "create_request") {
          onCreateRequest({
            method: action.method,
            url: action.url,
            headers: action.headers || {},
            body: action.body || "",
            label: action.label,
          });
        } else if (action.type === "create_assertions") {
          onCreateAssertions(action.assertions);
        } else if (action.type === "set_variable") {
          onSetVariable(action.name, action.value);
        } else if (action.type === "generated_code") {
          onGeneratedCode(action.generated);
        } else if (action.type === "remember_instruction") {
          onRememberInstruction(action.text);
        }
      }

      if (Array.isArray(data.instructionsUsed)) onInstructionsSent(data.instructionsUsed);
      if (typeof data.actionsUsed === "number") setActionsUsed(data.actionsUsed);
      if (typeof data.actionLimit === "number") setActionLimit(data.actionLimit);

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response || data.error || "sorry, something went wrong.",
        trace: data.trace,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      // Three different situations used to read as one sentence about port 4000.
      // Being told to check a port that is fine is worse than being told nothing.
      const stopped = err?.name === "AbortError";
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: stopped
            ? "Stopped waiting — the model did not answer in three minutes. Anything already done is in the log above."
            : "I could not reach ReqFlow's own backend. It runs on port 4000; check the terminal you started it in.",
        },
      ]);
    } finally {
      clearInterval(poll);
      setProgress(null);
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");


  const renderTrace = (msgId: string, trace?: ActionLogEntry[]) => {
    if (!trace || trace.length === 0) return null;
    return (
      <View style={styles.trace}>
        <Text style={styles.traceTitle}>
          {trace.length} action{trace.length === 1 ? "" : "s"}
        </Text>
        {trace.map((t, i) => {
          if (t.kind === "request") {
            const key = `${msgId}:${i}`;
            const open = expanded === key;
            // this response is already open in a tab. the inline peek is for
            // glancing back at an earlier action without hunting for its tab.
            const canOpen = !!t.response && t.response.data !== null;
            const ms = t.response?.timing.total;

            return (
              <View key={i}>
                <Pressable
                  // the row goes to the tab, the chevron peeks at the body
                  // without leaving the conversation
                  onPress={() => !t.refused && onFocusRequest(t.method, t.url)}
                  style={({ hovered }: any) => [
                    styles.traceRow,
                    !t.refused && hovered && styles.traceRowHover,
                  ]}
                >
                  {canOpen ? (
                    <Pressable
                      onPress={() => setExpanded(open ? null : key)}
                      style={styles.traceChevron}
                    >
                      <Icon
                        name={open ? "chevronDown" : "chevronRight"}
                        size={11}
                        color={colors.textDim}
                      />
                    </Pressable>
                  ) : (
                    <View style={styles.traceGutter} />
                  )}
                  <Text style={styles.traceLine} numberOfLines={1}>
                    <Text style={styles.traceMethod}>{t.method}</Text> {path(t.url)}{" "}
                    <Text
                      style={{
                        color: t.refused
                          ? colors.textDim
                          : (t.status ?? 0) < 400
                          ? colors.statusOk
                          : colors.statusErr,
                      }}
                    >
                      {t.refused ? "blocked" : t.status}
                    </Text>
                    {ms !== undefined && (
                      <Text style={{ color: colors.textDim }}> {ms}ms</Text>
                    )}
                  </Text>
                </Pressable>
                {open && t.response && (
                  <ScrollView style={styles.traceBody} nestedScrollEnabled>
                    <JsonView data={t.response.data} />
                  </ScrollView>
                )}
              </View>
            );
          }
          if (t.kind === "draft") {
            return (
              <View key={i} style={styles.traceRow}>
                <View style={styles.traceGutter} />
                <Text style={styles.traceLine} numberOfLines={1}>
                  <Text style={styles.traceVerb}>drafted</Text>{" "}
                  <Text style={styles.traceMethod}>{t.method}</Text> {path(t.url)}{" "}
                  <Text style={{ color: colors.textDim }}>not sent</Text>
                </Text>
              </View>
            );
          }
          if (t.kind === "code") {
            // the code view is a modal, so it is gone as soon as it is
            // dismissed. this row is the way back to it.
            return (
              <Pressable
                key={i}
                onPress={onShowCode}
                style={({ hovered }: any) => [styles.traceRow, hovered && styles.traceRowHover]}
              >
                <View style={styles.traceGutter} />
                <Text style={styles.traceLine} numberOfLines={1}>
                  <Text style={styles.traceVerb}>wrote</Text>{" "}
                  <Text style={styles.traceMethod}>{t.method}</Text> {t.path}{" "}
                  <Text style={{ color: colors.textDim }}>
                    {t.layers} file{t.layers === 1 ? "" : "s"}, not saved
                  </Text>
                </Text>
              </Pressable>
            );
          }
          if (t.kind === "assertions") {
            return (
              <View key={i} style={styles.traceRow}>
                <View style={styles.traceGutter} />
                <Text style={styles.traceLine} numberOfLines={1}>
                  <Text style={styles.traceVerb}>added</Text> {t.count} assertion
                  {t.count === 1 ? "" : "s"}
                </Text>
              </View>
            );
          }
          {/* the rule is quoted rather than counted: a log line saying "saved
              an instruction" leaves the user to open a panel to find out what
              the app now believes about them */}
          if (t.kind === "instruction") {
            return (
              <View key={i} style={styles.traceRow}>
                <View style={styles.traceGutter} />
                <Text style={styles.traceLine} numberOfLines={2}>
                  <Text style={styles.traceVerb}>remembered</Text> {t.text}
                </Text>
              </View>
            );
          }
          return (
            <View key={i} style={styles.traceRow}>
              <View style={styles.traceGutter} />
              <Text style={styles.traceLine} numberOfLines={1}>
                <Text style={styles.traceVerb}>set</Text> {`{{${t.name}}}`}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const clearChat = () => {
    // the action budget is per conversation, so clearing is also how you get a
    // fresh one after hitting the cap
    setMessages((prev) => prev.slice(0, 1));
    setActionsUsed(0);
  };

  const remaining = actionLimit - actionsUsed;

  return (
    <View style={styles.container}>
      {/* header */}
      <View style={styles.header}>
        <Icon name="sparkle" size={16} color={colors.text} />
        <Text style={styles.headerTitle}>AI Agent</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          style={({ hovered }: any) => [
            styles.writeToggle,
            allowWrites && styles.writeToggleOn,
            hovered && !allowWrites && styles.writeToggleHover,
          ]}
          onPress={() => setAllowWrites(!allowWrites)}
        >
          <Text style={[styles.writeToggleText, allowWrites && styles.writeToggleTextOn]}>
            {allowWrites ? "Can edit files" : "Read only"}
          </Text>
        </Pressable>
        {messages.length > 1 && (
          <Pressable
            style={({ hovered }: any) => [styles.writeToggle, hovered && styles.writeToggleHover]}
            onPress={clearChat}
          >
            <Text style={styles.writeToggleText}>Clear</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel="close the agent panel"
          style={({ hovered }: any) => [styles.closeWrap, hovered && styles.closeWrapHover]}
          onPress={onClose}
        >
          <Icon name="close" size={15} color={colors.textDim} />
        </Pressable>
      </View>

      {/* messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg) =>
          msg.role === "user" ? (
            <View key={msg.id} style={[styles.msgBubble, styles.userMsg]}>
              <Text style={styles.msgText}>{msg.content}</Text>
            </View>
          ) : (
            <LinearGradient
              key={msg.id}
              colors={["rgba(255, 255, 255, 0.06)", "rgba(24, 24, 26, 0.95)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.msgBubble, styles.aiMsg]}
            >
              <Text style={styles.msgText}>{msg.content}</Text>
              {renderTrace(msg.id, msg.trace)}
            </LinearGradient>
          )
        )}
        {loading && (
          <View style={[styles.msgBubble, styles.aiMsg, styles.working]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.workingText} numberOfLines={1}>
              {progress || "thinking"}
            </Text>
            {/* A run can be half a minute, and until this there was no way out
                of it but to wait. Stopping is honoured between actions, so what
                has already been done stays done and nothing is left half way. */}
            <Pressable
              onPress={() => cancelRun("ai-chat", runIdRef.current)}
              style={({ hovered }: any) => [styles.stopRun, hovered && styles.stopRunHover]}
              accessibilityLabel="stop this run"
            >
              <Text style={styles.stopRunText}>Stop</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* the cap is invisible until it starts to matter */}
      {actionsUsed > 0 && (
        <View style={styles.budget}>
          <Text style={[styles.budgetText, remaining === 0 && styles.budgetTextOut]}>
            {remaining === 0
              ? `${actionLimit} action limit reached — clear the chat for a fresh budget`
              : `${actionsUsed} of ${actionLimit} actions used`}
          </Text>
        </View>
      )}

      {/* input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          // A name for the box that does not change when its wording does. The
          // demo harness was selecting it by placeholder text, so rewording the
          // placeholder broke five runs that had nothing wrong with them.
          accessibilityLabel="ask the agent"
          placeholder="Add a POST /api/users endpoint"
          placeholderTextColor={colors.textDim}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          autoCapitalize="none"
        />
        <Pressable
          accessibilityLabel="send"
          style={({ pressed }: any) => [
            styles.sendBtnWrap,
            (!input.trim() || loading) && styles.sendDisabled,
            pressed && styles.sendPressed,
          ]}
          onPress={sendMessage}
          disabled={!input.trim() || loading}
        >
          <LinearGradient
            colors={[colors.accent, colors.accentLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendBtn}
          >
            <Icon name="arrowRight" size={16} color={colors.bg} />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 320,
    backgroundColor: colors.surface,
    ...shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerIcon: {
    color: colors.accent,
    fontSize: 16,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  closeWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  closeWrapHover: {
    backgroundColor: colors.hover,
  },
  closeBtn: {
    color: colors.textDim,
    fontSize: 20,
    lineHeight: 22,
  },
  writeToggle: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginRight: 6,
    ...transition("background-color, border-color"),
  },
  writeToggleHover: {
    backgroundColor: colors.hover,
  },
  writeToggleOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  writeToggleText: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "500",
  },
  writeToggleTextOn: {
    color: colors.accent,
  },
  messages: {
    flex: 1,
    padding: 12,
  },
  msgBubble: {
    padding: 11,
    borderRadius: radius.lg,
    marginBottom: 8,
    maxWidth: "90%",
  },
  userMsg: {
    backgroundColor: colors.accentDim,
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  aiMsg: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
    ...shadow.sm,
  },
  msgText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  trace: {
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  traceTitle: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "500",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  traceLine: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: "monospace",
    marginBottom: 2,
  },
  traceMethod: {
    color: colors.text,
  },
  traceVerb: {
    color: colors.textDim,
  },
  stopRun: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  stopRunHover: {
    backgroundColor: colors.hover,
  },
  stopRunText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "500",
  },
  working: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
  },
  workingText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
    fontFamily: "monospace",
  },
  traceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  traceRowHover: {
    backgroundColor: colors.hover,
  },
  // keeps lines with no response to open aligned with the ones that have a chevron
  traceGutter: {
    width: 11,
  },
  traceChevron: {
    width: 11,
    alignItems: "center",
  },
  traceBody: {
    maxHeight: 220,
    marginTop: 4,
    marginBottom: 6,
    marginLeft: 15,
    padding: 8,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
  },
  budget: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  budgetText: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: "monospace",
  },
  budgetTextOut: {
    color: colors.statusErr,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    ...shadow.sm,
    ...transition("box-shadow, background-color"),
  },
  sendBtnWrap: {
    borderRadius: radius.md,
    ...shadow.sm,
    ...transition("opacity"),
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: {
    opacity: 0.82,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: "500",
  },
});
