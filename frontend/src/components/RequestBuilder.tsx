import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { radius, shadow, glow, transition } from "../theme/tokens";
import Icon from "./Icon";
import SubTabs from "./SubTabs";
import HeadersEditor from "./HeadersEditor";
import TestRunner from "./TestRunner";
import ResponseViewer from "./ResponseViewer";
import { SubTab, TestCase } from "../types";
import { paramsFromUrl, urlWithParams } from "../lib/queryParams";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

interface HeaderRow {
  key: string;
  value: string;
  enabled: boolean;
}

interface Props {
  method: string;
  url: string;
  body: string;
  headers: HeaderRow[];
  tests: TestCase[];
  onMethodChange: (m: string) => void;
  onUrlChange: (u: string) => void;
  onBodyChange: (b: string) => void;
  onHeadersChange: (h: HeaderRow[]) => void;
  onTestsChange: (tests: TestCase[]) => void;
  onSend: () => void;
  loading: boolean;
  response: any;
  timingNote?: { text: string; slower: boolean } | null;
}

export default function RequestBuilder({
  method,
  url,
  body,
  headers,
  tests,
  onMethodChange,
  onUrlChange,
  onBodyChange,
  onHeadersChange,
  onTestsChange,
  onSend,
  loading,
  response,
  timingNote,
}: Props) {
  const [showMethodPicker, setShowMethodPicker] = React.useState(false);
  const [activeSubTab, setActiveSubTab] = React.useState<SubTab>("body");
  const [curlCopied, setCurlCopied] = React.useState(false);
  const [formatError, setFormatError] = React.useState<string | null>(null);

  // a static Send button during a slow request looks frozen. this counts up
  // from the moment of the press, so the wait is visibly a wait.
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(id);
  }, [loading]);

  // ctrl+enter / cmd+enter sends. web only, a phone has no such shortcut.
  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: any) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!loading) onSend();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSend, loading]);

  const formatBody = () => {
    if (!body.trim()) return;
    try {
      onBodyChange(JSON.stringify(JSON.parse(body), null, 2));
      setFormatError(null);
    } catch (err: any) {
      setFormatError(err.message);
    }
  };

  const copyAsCurl = async () => {
    const parts = [`curl -X ${method}`, `'${url}'`];
    headers
      .filter((h) => h.enabled && h.key.trim())
      .forEach((h) => parts.push(`-H '${h.key}: ${h.value}'`));
    if (["POST", "PUT", "PATCH"].includes(method) && body.trim()) {
      // single quotes inside the body would end the shell quote early
      parts.push(`-d '${body.replace(/'/g, "'\\''")}'`);
    }
    await Clipboard.setStringAsync(parts.join(" \\\n  "));
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 1600);
  };

  const enabledHeaderCount = headers.filter((h) => h.enabled && h.key.trim()).length;
  const methodColor = (colors.method as any)[method] || colors.text;
  const ok = response && response.status < 400;

  return (
    <View style={styles.container}>
      {/* request row */}
      <View style={styles.requestRow}>
        <Pressable
          style={({ hovered }: any) => [
            styles.methodBtn,
            { backgroundColor: methodColor + "1f" },
            hovered && { backgroundColor: methodColor + "33" },
          ]}
          onPress={() => setShowMethodPicker(!showMethodPicker)}
        >
          <Text style={[styles.methodText, { color: methodColor }]}>{method}</Text>
          <Icon name="chevronDown" size={13} color={methodColor} />
        </Pressable>

        <TextInput
          style={styles.urlInput}
          placeholder="http://localhost:3000/api/..."
          placeholderTextColor={colors.textDim}
          value={url}
          onChangeText={onUrlChange}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable
          style={({ hovered }: any) => [styles.curlBtn, hovered && styles.curlBtnHover]}
          onPress={copyAsCurl}
        >
          <Icon
            name={curlCopied ? "check" : "terminal"}
            size={14}
            color={curlCopied ? colors.statusOk : colors.textDim}
          />
          <Text style={[styles.curlText, curlCopied && { color: colors.statusOk }]}>
            {curlCopied ? "Copied" : "cURL"}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }: any) => [
            styles.sendBtnWrap,
            loading && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
          onPress={onSend}
          disabled={loading}
        >
          <LinearGradient
            colors={[colors.accent, colors.accentLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendBtn}
          >
            {loading ? (
              <View style={styles.sendingRow}>
                <ActivityIndicator size="small" color={colors.bg} />
                <Text style={styles.sendBtnText}>{(elapsed / 1000).toFixed(1)}s</Text>
              </View>
            ) : (
              <Text style={styles.sendBtnText}>Send</Text>
            )}
          </LinearGradient>
        </Pressable>
      </View>

      {/* method picker */}
      {showMethodPicker && (
        <View style={styles.methodPicker}>
          {METHODS.map((m) => (
            <Pressable
              key={m}
              style={({ hovered }: any) => [
                styles.methodOption,
                hovered && styles.methodOptionHover,
              ]}
              onPress={() => {
                onMethodChange(m);
                setShowMethodPicker(false);
              }}
            >
              <Text
                style={{
                  color: (colors.method as any)[m],
                  fontWeight: "500",
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              >
                {m}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* sub tabs */}
      <SubTabs
        activeSubTab={activeSubTab}
        onSelect={setActiveSubTab}
        headerCount={enabledHeaderCount}
        hasBody={body.trim().length > 0}
      />

      {/* sub tab content */}
      <View style={styles.subContent}>
        {activeSubTab === "headers" && (
          <HeadersEditor headers={headers} onChange={onHeadersChange} />
        )}

        {activeSubTab === "body" && (
          <View style={styles.bodySection}>
            <View style={styles.bodyToolbar}>
              <Pressable
                style={({ hovered }: any) => [styles.smallBtn, hovered && styles.smallBtnHover]}
                onPress={formatBody}
              >
                <Text style={styles.smallBtnText}>Format JSON</Text>
              </Pressable>
              {formatError && (
                <Text style={styles.formatError} numberOfLines={1}>
                  {formatError}
                </Text>
              )}
              <View style={{ flex: 1 }} />
              <Text style={styles.hint}>
                {Platform.OS === "web" ? "Ctrl+Enter to send" : ""}
              </Text>
            </View>
            <TextInput
              style={styles.bodyInput}
              multiline
              value={body}
              onChangeText={onBodyChange}
              placeholder='{"key": "value"}'
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
            />
          </View>
        )}

        {activeSubTab === "auth" && (
          <View style={styles.authSection}>
            <Text style={styles.authLabel}>Bearer Token</Text>
            <TextInput
              style={styles.urlInput}
              placeholder="paste JWT token here"
              placeholderTextColor={colors.textDim}
              value={headers.find((h) => h.key === "Authorization")?.value.replace("Bearer ", "") || ""}
              onChangeText={(token) => {
                const existing = headers.findIndex((h) => h.key === "Authorization");
                const newHeaders = [...headers];
                if (existing >= 0) {
                  newHeaders[existing] = { key: "Authorization", value: `Bearer ${token}`, enabled: true };
                } else {
                  newHeaders.push({ key: "Authorization", value: `Bearer ${token}`, enabled: true });
                }
                onHeadersChange(newHeaders);
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {activeSubTab === "params" && (
          <HeadersEditor
            headers={paramsFromUrl(url)}
            onChange={(rows) => onUrlChange(urlWithParams(url, rows))}
            keyPlaceholder="param name"
            addLabel="+ Add Param"
            emptyHint="No query parameters. Adding one here writes it into the URL."
          />
        )}


        {activeSubTab === "tests" && (
          <TestRunner tests={tests} onChange={onTestsChange} response={response} />
        )}
      </View>

      <ResponseViewer response={response} loading={loading} timingNote={timingNote} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  methodBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: radius.md,
    minWidth: 84,
    justifyContent: "center",
    ...transition("background-color"),
  },
  methodText: {
    fontWeight: "500",
    fontSize: 13,
    fontFamily: "monospace",
  },
  urlInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13,
    fontFamily: "monospace",
    ...shadow.sm,
    ...transition("box-shadow, background-color"),
  },
  curlBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLight,
    ...shadow.sm,
    ...transition("background-color"),
  },
  curlBtnHover: {
    backgroundColor: colors.hover,
  },
  curlText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "500",
  },
  bodyToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  smallBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
    ...transition("background-color"),
  },
  smallBtnHover: {
    backgroundColor: colors.hover,
  },
  smallBtnText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "500",
  },
  formatError: {
    flex: 1,
    color: colors.statusErr,
    fontSize: 11,
  },
  hint: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: "monospace",
  },
  sendBtnWrap: {
    borderRadius: radius.md,
    ...shadow.sm,
    ...transition("opacity, transform"),
  },
  sendBtn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    // wide enough for the timer, so the row does not shift when it appears
    minWidth: 108,
  },
  sendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  sendBtnPressed: {
    opacity: 0.82,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: colors.bg,
    fontWeight: "500",
    fontSize: 14,
  },
  methodPicker: {
    position: "absolute",
    top: 58,
    left: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    zIndex: 100,
    padding: 4,
    ...shadow.md,
  },
  methodOption: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  methodOptionHover: {
    backgroundColor: colors.hover,
  },
  subContent: {
    minHeight: 100,
  },
  bodySection: {
    padding: 12,
  },
  bodyInput: {
    backgroundColor: colors.surfaceLight,
    color: colors.code,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 13,
    fontFamily: "monospace",
    minHeight: 120,
    ...shadow.sm,
  },
  authSection: {
    padding: 12,
  },
  authLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 8,
  },
  responseSection: {
    flex: 1,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  responseDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  responseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 10,
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  statusText: {
    fontWeight: "500",
    fontSize: 13,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timing: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "500",
  },
  responseBody: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    ...shadow.sm,
  },
  responseText: {
    color: colors.code,
    fontSize: 12,
    fontFamily: "monospace",
  },
});
