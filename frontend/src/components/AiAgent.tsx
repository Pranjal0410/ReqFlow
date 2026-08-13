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
import { DetectedRoute, ApiResponse } from "../types";
import { CONFIG } from "../config";
import Icon from "./Icon";
import JsonView from "./JsonView";

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
  | { kind: "variable"; name: string };

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
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I act on what you ask without checking in first, and everything I do shows up in a log under each reply. Ask me to:\n\n• test endpoints, one or all of them\n• set up a request in a tab for you to review and send\n• write assertions into the Tests panel\n• explain or debug a response you are stuck on\n\nI work through login flows too, so protected routes are fine. Two limits: I can only reach localhost and private network addresses, and I get 30 actions per conversation.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // autonomous by default. read-only is here for when you want it, not the
  // starting position.
  const [allowWrites, setAllowWrites] = useState(true);
  const [actionsUsed, setActionsUsed] = useState(0);
  const [actionLimit, setActionLimit] = useState(30);
  // which response in the log is open. one at a time keeps the panel readable.
  const [expanded, setExpanded] = useState<string | null>(null);
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

    try {
      // build context about detected routes
      const routeContext = routes.length > 0
        ? `\n\nDetected API endpoints in the current project:\n${routes
            .map((r) => `${r.method} ${r.path} - ${r.description}`)
            .join("\n")}`
        : "\n\nNo project has been scanned yet.";

      const res = await fetch(`${CONFIG.API_BASE}/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          routeContext,
          baseUrl,
          allowWrites,
          actionsUsed,
          activeTab,
          variables,
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

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
        }
      }

      if (typeof data.actionsUsed === "number") setActionsUsed(data.actionsUsed);
      if (typeof data.actionLimit === "number") setActionLimit(data.actionLimit);

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response || data.error || "sorry, something went wrong.",
        trace: data.trace,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "couldn't reach the backend. is the server running on port 4000?",
        },
      ]);
    } finally {
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
            {allowWrites ? "writes on" : "read only"}
          </Text>
        </Pressable>
        {messages.length > 1 && (
          <Pressable
            style={({ hovered }: any) => [styles.writeToggle, hovered && styles.writeToggleHover]}
            onPress={clearChat}
          >
            <Text style={styles.writeToggleText}>clear</Text>
          </Pressable>
        )}
        <Pressable
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
          <View style={[styles.msgBubble, styles.aiMsg]}>
            <ActivityIndicator size="small" color={colors.accent} />
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
          placeholder="Ask me anything about your APIs..."
          placeholderTextColor={colors.textDim}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          autoCapitalize="none"
        />
        <Pressable
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
