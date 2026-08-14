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
import { namesIn, unfilled } from "../lib/pathParams";
import { placeholderFields } from "../lib/placeholders";
import { missingIn } from "../lib/variables";

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
  // used only to word the empty state: whether a scan has happened yet
  routeCount: number;
  onScanPress: () => void;
  pathParams: Record<string, string>;
  onPathParamsChange: (values: Record<string, string>) => void;
  onSaveToken: (value: string) => void;
  savedToken?: string | null;
  variables: Record<string, string>;
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
  routeCount,
  onScanPress,
  pathParams,
  onPathParamsChange,
  onSaveToken,
  savedToken,
  variables,
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

  // opening a route with :id in it lands you where you have to type, once,
  // without fighting a later choice to look at something else
  React.useEffect(() => {
    if (unfilled(url, pathParams).length > 0) setActiveSubTab("params");
    // only when the request itself changes, not on every keystroke in the box
  }, [url]);

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

  // pressing Send on an empty url used to do nothing at all, with no hint that
  // anything was missing, which reads as the app being broken
  const pathNames = namesIn(url);
  // not a reason to block: some apis really do accept any string. it is a
  // reason to say so before the request comes back rejected.
  const placeholders = placeholderFields(body);
  const missingPath = unfilled(url, pathParams);
  // a {{name}} with nothing behind it would be sent as an empty string, so the
  // request fails somewhere far from the cause
  const missingVars = [
    ...new Set([
      ...missingIn(url, variables),
      ...headers.filter((h) => h.enabled).flatMap((h) => missingIn(h.value, variables)),
      ...missingIn(body, variables),
    ]),
  ];
  // sending /api/incidents/:id verbatim only ever produces a confusing 404, so
  // say what is missing instead of letting it go
  const canSend = url.trim().length > 0 && missingPath.length === 0 && missingVars.length === 0;
  const enabledHeaderCount = headers.filter((h) => h.enabled && h.key.trim()).length;
  const methodColor = (colors.method as any)[method] || colors.text;
  const ok = response && response.status >= 200 && response.status < 400;

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
            (loading || !canSend) && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
          onPress={onSend}
          disabled={loading || !canSend}
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

      {/* under the url rather than in one sub tab's toolbar, so the reason Send
          is disabled is visible from wherever you happen to be */}
      {!canSend && (
        <Text style={styles.blocked}>
          {missingPath.length
            ? `Fill ${missingPath.map((n) => ":" + n).join(", ")} under Params before sending`
            : missingVars.length
            ? `${missingVars.map((n) => "{{" + n + "}}").join(", ")} has no value. Variables are cleared when the browser closes, so log in again to refill it.`
            : "Enter a URL to send"}
        </Text>
      )}

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

      {/* nothing has been typed and nothing has been scanned, so the editors
          below are asking about a request that does not exist yet. say what to
          do instead of showing an empty body field. */}
      {!canSend && routeCount === 0 ? (
        <View style={styles.blank}>
          <Text style={styles.blankTitle}>Nothing to send yet</Text>
          <Text style={styles.blankBody}>
            Scan a project and ReqFlow will list its routes in the sidebar, ready
            to open in a tab. Or type a URL above and press Send.
          </Text>
          <Pressable
            style={({ hovered }: any) => [styles.blankBtn, hovered && styles.blankBtnHover]}
            onPress={onScanPress}
          >
            <Text style={styles.blankBtnText}>Scan Project</Text>
          </Pressable>
          <Text style={styles.blankAside}>
            The agent on the right can also run them for you once there is a
            project to point it at.
          </Text>
        </View>
      ) : (
      <>
      {/* sub tabs */}
      <SubTabs
        activeSubTab={activeSubTab}
        onSelect={setActiveSubTab}
        headerCount={enabledHeaderCount}
        hasBody={body.trim().length > 0}
        pathPending={missingPath.length}
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
              {!formatError && placeholders.length > 0 && (
                <Text style={styles.placeholderNote} numberOfLines={1}>
                  {placeholders.join(", ")} still {placeholders.length === 1 ? "says" : "say"} what
                  type to put there
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
          <View>
            {/* a scanned route arrives with :id in it. filling it here keeps the
                placeholder in the url, so it can be changed again later. */}
            {pathNames.length > 0 && (
              <View style={styles.pathBox}>
                <Text style={styles.pathTitle}>Path</Text>
                {pathNames.map((name) => (
                  <View key={name} style={styles.pathRow}>
                    <Text style={styles.pathName}>:{name}</Text>
                    <TextInput
                      style={styles.pathInput}
                      placeholder={`value for :${name}`}
                      placeholderTextColor={colors.textDim}
                      value={pathParams[name] || ""}
                      onChangeText={(v) => onPathParamsChange({ ...pathParams, [name]: v })}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                ))}
              </View>
            )}
          <HeadersEditor
            headers={paramsFromUrl(url)}
            onChange={(rows) => onUrlChange(urlWithParams(url, rows))}
            keyPlaceholder="param name"
            addLabel="+ Add Param"
            emptyHint="No query parameters. Adding one here writes it into the URL."
            showToggle={false}
          />
          </View>
        )}


        {activeSubTab === "tests" && (
          <TestRunner tests={tests} onChange={onTestsChange} response={response} />
        )}
      </View>

      <ResponseViewer
        response={response}
        loading={loading}
        timingNote={timingNote}
        onSaveToken={onSaveToken}
        savedTokenPath={savedToken}
      />
      </>
      )}
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
  placeholderNote: {
    flex: 1,
    color: colors.textDim,
    fontSize: 11,
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
  blocked: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    paddingHorizontal: 14,
    marginTop: -4,
    marginBottom: 6,
  },
  pathBox: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  pathTitle: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  pathRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  pathName: {
    color: colors.accent,
    fontSize: 12,
    fontFamily: "monospace",
    width: 110,
  },
  pathInput: {
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
  blank: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  blankTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 8,
  },
  blankBody: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 420,
    marginBottom: 18,
  },
  blankBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  blankBtnHover: {
    backgroundColor: colors.hover,
  },
  blankBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
  blankAside: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 380,
    marginTop: 22,
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
