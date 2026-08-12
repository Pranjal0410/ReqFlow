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
import { DetectedRoute } from "../types";
import { CONFIG } from "../config";
import Icon from "./Icon";

interface TraceEntry {
  method: string;
  url: string;
  status: number | null;
  refused: boolean;
}

interface Message {
  id: string;
  role: "assistant" | "user";
  content: string;
  trace?: TraceEntry[];
}

interface Props {
  routes: DetectedRoute[];
  onSelectRoute?: (route: DetectedRoute) => void;
  visible: boolean;
  onClose: () => void;
  baseUrl: string;
}

export default function AiAgent({ routes, visible, onClose, baseUrl }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I can help you with API development. You can ask me to:\n\n• test endpoints\n• generate requests\n• explain APIs\n• debug issues\n• create tests",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowWrites, setAllowWrites] = useState(false);
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
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await res.json();

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

  const renderTrace = (trace?: TraceEntry[]) => {
    if (!trace || trace.length === 0) return null;
    return (
      <View style={styles.trace}>
        <Text style={styles.traceTitle}>
          {trace.length} request{trace.length === 1 ? "" : "s"} sent
        </Text>
        {trace.map((t, i) => (
          <Text key={i} style={styles.traceLine} numberOfLines={1}>
            <Text style={styles.traceMethod}>{t.method}</Text>{" "}
            {t.url.replace(/^https?:\/\/[^/]+/, "")}{" "}
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
          </Text>
        ))}
      </View>
    );
  };

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
              {renderTrace(msg.trace)}
            </LinearGradient>
          )
        )}
        {loading && (
          <View style={[styles.msgBubble, styles.aiMsg]}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        )}
      </ScrollView>

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
