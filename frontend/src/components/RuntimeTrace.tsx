import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import { ServerTimingSpan } from "../types";
import Icon from "./Icon";

interface TraceStep {
  label: string;
  detail: string;
  // what the card's bottom line reads. not always a duration: the response
  // card carries a size, and a server span with no dur carries nothing.
  value: string;
  // null when the step has no duration to put on a bar in the expanded view
  time: number | null;
  accent: string;
  // true for the spans the target server reported about itself. the ui says so
  // out loud, because those numbers are its word and not our measurement.
  reported?: boolean;
}

interface Props {
  response: any;
  method: string;
  url: string;
}

function safePath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// server-timing durations arrive as fractions of a millisecond fairly often.
// keep one decimal for those instead of rounding a 0.4 ms span down to nothing.
function ms(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function serverSteps(spans: ServerTimingSpan[]): TraceStep[] {
  return spans.map((span) => ({
    label: span.name,
    detail: span.description || "server span",
    // the header may name a span without timing it, and an untimed span is
    // still worth showing. it just has no number to show with it.
    value: span.duration === null ? "no duration sent" : `${ms(span.duration)} ms`,
    time: span.duration,
    accent: colors.traceProcessing,
    reported: true,
  }));
}

export default function RuntimeTrace({ response, method, url }: Props) {
  // hooks must run on every render, so the pulse is set up before the
  // early return below
  const pulse = React.useRef(new Animated.Value(1)).current;
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!response) return;
    pulse.setValue(0.45);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [response, pulse]);

  if (!response) return null;

  const total = response.timing.total;
  const spans: ServerTimingSpan[] = response.serverTiming ?? [];

  // the two figures we measure ourselves. the backend times the wait for the
  // first byte separately from reading the body, so neither is a guess.
  const ttfb = response.timing.ttfb ?? 0;
  const download = response.timing.download ?? 0;

  // the server's own spans go between the wait and the download, because that
  // is when they happened: everything it reports took place inside the ttfb
  // window, before the first byte reached us.
  const steps: TraceStep[] = [
    {
      label: "HTTP Request",
      detail: `${method} ${safePath(url)}`,
      value: `${ms(total)} ms total`,
      time: total,
      accent: colors.traceRequest,
    },
    {
      label: "Waiting (TTFB)",
      detail: "until first byte",
      value: `${ms(ttfb)} ms`,
      time: ttfb,
      accent: colors.traceRequest,
    },
    ...serverSteps(spans),
    {
      label: "Download",
      detail: `${response.size ?? 0} B body`,
      value: `${ms(download)} ms`,
      time: download,
      accent: colors.traceProcessing,
    },
    {
      label: "Response",
      detail: `${response.status} ${response.statusText || ""}`.trim(),
      value: `${response.size ?? 0} B`,
      time: null,
      accent: colors.traceResponse,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Runtime Trace</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          style={({ hovered }: any) => [styles.expandBtn, hovered && styles.expandBtnHover]}
          onPress={() => setExpanded(!expanded)}
        >
          <Text style={styles.expandText}>
            {expanded ? "Hide detail" : "View full trace"}
          </Text>
          <Icon
            name={expanded ? "chevronDown" : "chevronRight"}
            size={12}
            color={colors.textDim}
          />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.traceRow}>
          {steps.map((step, i) => (
            <View key={i} style={[styles.traceCard, { borderLeftColor: step.accent }]}>
              <View style={styles.traceLabelRow}>
                <Text style={[styles.traceLabel, { color: step.accent }]} numberOfLines={1}>
                  {step.label}
                </Text>
                {step.reported && <Text style={styles.reportedTag}>reported</Text>}
              </View>
              <Text style={styles.traceDetail} numberOfLines={1}>
                {step.detail}
              </Text>
              <Animated.Text style={[styles.traceTime, { opacity: pulse }]}>
                {step.value}
              </Animated.Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {expanded && (
        <View style={styles.detail}>
          {steps.slice(1).map((step, i) => {
            if (step.time === null) return null;
            const share = total > 0 ? Math.round((step.time / total) * 100) : 0;
            return (
              <View key={i} style={styles.detailRow}>
                <View style={[styles.detailDot, { backgroundColor: step.accent }]} />
                <Text style={styles.detailLabel} numberOfLines={1}>
                  {step.label}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.min(share, 100)}%`, backgroundColor: step.accent },
                    ]}
                  />
                </View>
                <Text style={styles.detailTime}>{ms(step.time)} ms</Text>
                <Text style={styles.detailShare}>{share}%</Text>
              </View>
            );
          })}

          <View style={styles.detailRow}>
            <View style={[styles.detailDot, { backgroundColor: colors.traceResponse }]} />
            <Text style={styles.detailLabel}>Status</Text>
            <View style={styles.barTrack} />
            <Text style={styles.detailTime}>{response.status}</Text>
            <Text style={styles.detailShare}>
              {response.sizeSource === "content-length" ? "hdr" : "read"}
            </Text>
          </View>

          <Text style={styles.detailNote}>
            Measured on the ReqFlow backend. TTFB is the wait for the first byte,
            download is the time spent reading the body. Time spent between your
            browser and ReqFlow itself is not included.
          </Text>

          <Text style={styles.detailNote}>
            {spans.length > 0
              ? "Steps marked reported come from the target server's Server-Timing header. They are its own account of what it did inside the wait above, so they need not add up to it."
              : "This server sent no Server-Timing header, so what it did between receiving the request and answering is not visible from out here. Add the header on the server to see those steps."}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    padding: 12,
    ...shadow.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  expandBtnHover: {
    backgroundColor: colors.hover,
  },
  expandText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  detail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 7,
  },
  detailDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 11,
    width: 130,
  },
  barTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surfaceLight,
    overflow: "hidden",
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },
  detailTime: {
    color: colors.text,
    fontSize: 11,
    fontFamily: "monospace",
    width: 58,
    textAlign: "right",
  },
  detailShare: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
    width: 38,
    textAlign: "right",
  },
  detailNote: {
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 6,
  },
  traceRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  traceCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 13,
    minWidth: 158,
    borderLeftWidth: 3,
    ...shadow.sm,
  },
  traceLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  traceLabel: {
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  reportedTag: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  traceDetail: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: "monospace",
    marginBottom: 5,
  },
  traceTime: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: "monospace",
  },
});
