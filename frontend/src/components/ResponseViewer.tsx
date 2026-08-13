import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { radius, shadow, glow, transition } from "../theme/tokens";
import Icon from "./Icon";
import JsonView from "./JsonView";
import { findToken } from "../lib/variables";

interface Props {
  response: any;
  loading?: boolean;
  // offered when the body carries something that looks like a credential
  onSaveToken?: (value: string) => void;
  savedTokenPath?: string | null;
  // how this run compares with earlier runs of the same endpoint, or null when
  // there is not enough history to say anything
  timingNote?: { text: string; slower: boolean } | null;
}

export default function ResponseViewer({ response, loading, timingNote, onSaveToken, savedTokenPath }: Props) {
  const [raw, setRaw] = React.useState(false);
  const [showHeaders, setShowHeaders] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const bodyRef = React.useRef<ScrollView>(null);

  // the value every later request needs, offered where it appears instead of
  // leaving it to be read out of the body and pasted into each tab
  const token = React.useMemo(
    () => (response ? findToken(response.data) : null),
    [response]
  );

  // a re-sent request reuses this view, and the old scroll offset survives, so
  // a fresh response would open somewhere in its middle
  React.useEffect(() => {
    bodyRef.current?.scrollTo({ y: 0, animated: false });
  }, [response]);

  // the previous response is cleared the moment Send is pressed, so without
  // this the panel would blink out of existence for the length of the request
  if (!response) {
    if (!loading) return null;
    return (
      <View style={styles.section}>
        <View style={styles.divider} />
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.waitingText}>waiting for a response</Text>
        </View>
      </View>
    );
  }

  // status 0 is the proxy saying it never got a reply. it is less than 400, so
  // a refused connection used to be painted with the success colour.
  const ok = response.status >= 200 && response.status < 400;

  // a connection error puts its whole message in statusText, which then crowds
  // the timing and size out of the row. the body still has it in full.
  const statusLabel = `${response.status} ${response.statusText || ""}`.trim();
  const headerEntries = Object.entries(response.headers || {});

  const copy = async () => {
    const text =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data, null, 2);
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={styles.section}>
      <View style={styles.divider} />

      <View style={styles.header}>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: ok
                ? "rgba(74, 222, 128, 0.14)"
                : "rgba(248, 113, 113, 0.14)",
            },
            glow(ok ? colors.statusOk : colors.statusErr),
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: ok ? colors.statusOk : colors.statusErr },
            ]}
          >
            {statusLabel.length > 46 ? statusLabel.slice(0, 46) + "…" : statusLabel}
          </Text>
        </View>

        <View style={styles.metaItem}>
          <Icon name="clock" size={13} color={colors.textDim} />
          <Text style={styles.meta}>{response.timing.total} ms</Text>
          {timingNote && (
            <Text style={[styles.timingNote, timingNote.slower && styles.timingNoteSlow]}>
              {timingNote.text}
            </Text>
          )}
        </View>

        <View style={styles.metaItem}>
          <Icon name="weight" size={13} color={colors.textDim} />
          <Text style={styles.meta}>
            {response.size ?? 0} B
            {response.sizeSource === "measured" ? " (read)" : ""}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        {/* pretty / raw */}
        <View style={styles.segmented}>
          <Pressable
            style={[styles.segment, !raw && styles.segmentOn]}
            onPress={() => setRaw(false)}
          >
            <Text style={[styles.segmentText, !raw && styles.segmentTextOn]}>Pretty</Text>
          </Pressable>
          <Pressable
            style={[styles.segment, raw && styles.segmentOn]}
            onPress={() => setRaw(true)}
          >
            <Text style={[styles.segmentText, raw && styles.segmentTextOn]}>Raw</Text>
          </Pressable>
        </View>

        {token && onSaveToken && (
          <Pressable
            style={({ hovered }: any) => [styles.action, hovered && styles.actionHover]}
            onPress={() => onSaveToken(token.value)}
          >
            <Icon
              name={savedTokenPath === token.value ? "check" : "sparkle"}
              size={13}
              color={savedTokenPath === token.value ? colors.statusOk : colors.accent}
            />
            <Text
              style={[
                styles.actionText,
                { color: savedTokenPath === token.value ? colors.statusOk : colors.accent },
              ]}
            >
              {savedTokenPath === token.value ? "Saved as {{token}}" : `Use ${token.path}`}
            </Text>
          </Pressable>
        )}

        <Pressable
          style={({ hovered }: any) => [styles.action, hovered && styles.actionHover]}
          onPress={copy}
        >
          <Icon
            name={copied ? "check" : "copy"}
            size={13}
            color={copied ? colors.statusOk : colors.textDim}
          />
          <Text style={[styles.actionText, copied && { color: colors.statusOk }]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>

      {/* response headers */}
      <Pressable
        style={({ hovered }: any) => [styles.headersToggle, hovered && styles.actionHover]}
        onPress={() => setShowHeaders(!showHeaders)}
      >
        <Icon
          name={showHeaders ? "chevronDown" : "chevronRight"}
          size={13}
          color={colors.textDim}
        />
        <Text style={styles.headersToggleText}>
          Response headers ({headerEntries.length})
        </Text>
      </Pressable>

      {showHeaders && (
        <ScrollView style={styles.headersBox} nestedScrollEnabled>
          {headerEntries.map(([k, v]) => (
            <View key={k} style={styles.headerRow}>
              <Text style={styles.headerKey}>{k}</Text>
              <Text style={styles.headerValue} selectable>
                {String(v)}
              </Text>
            </View>
          ))}
          {headerEntries.length === 0 && (
            <Text style={styles.headerValue}>no headers returned</Text>
          )}
        </ScrollView>
      )}

      <ScrollView ref={bodyRef} style={styles.body} nestedScrollEnabled>
        <JsonView data={response.data} raw={raw} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    flex: 1,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  waiting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 6,
  },
  waitingText: {
    color: colors.textDim,
    fontSize: 12,
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
  timingNote: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
  timingNoteSlow: {
    color: colors.statusErr,
    fontWeight: "500",
  },
  meta: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "500",
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.sm,
    padding: 2,
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm - 2,
    ...transition("background-color"),
  },
  segmentOn: {
    backgroundColor: colors.hover,
  },
  segmentText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  segmentTextOn: {
    color: colors.text,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  actionHover: {
    backgroundColor: colors.hover,
  },
  actionText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  headersToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: radius.sm,
    marginBottom: 6,
    ...transition("background-color"),
  },
  headersToggleText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  headersBox: {
    maxHeight: 140,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 8,
    ...shadow.sm,
  },
  headerRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 3,
  },
  headerKey: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: "monospace",
    width: 170,
  },
  headerValue: {
    flex: 1,
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
  body: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    ...shadow.sm,
  },
});
