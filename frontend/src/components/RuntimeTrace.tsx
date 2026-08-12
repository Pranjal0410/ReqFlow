import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import Icon from "./Icon";

interface TraceStep {
  label: string;
  detail: string;
  time: number;
  accent: string;
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

  // build trace steps from the response data
  const total = response.timing.total;

  // both figures come from the backend, which times the wait for the first
  // byte separately from reading the body. nothing here is a guess.
  const steps: TraceStep[] = [
    {
      label: "Waiting (TTFB)",
      detail: `${method} ${safePath(url)}`,
      time: response.timing.ttfb ?? 0,
      accent: colors.traceRequest,
    },
    {
      label: "Download",
      detail: `${response.size ?? 0} B body`,
      time: response.timing.download ?? 0,
      accent: colors.traceProcessing,
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
          <Icon
            name={expanded ? "chevronDown" : "chevronRight"}
            size={12}
            color={colors.textDim}
          />
          <Text style={styles.expandText}>
            {expanded ? "Hide detail" : "View full trace"}
          </Text>
        </Pressable>
        <Text style={styles.totalTime}>{total} ms total</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.traceRow}>
          {steps.map((step, i) => (
            <React.Fragment key={i}>
              <View style={[styles.traceCard, { borderLeftColor: step.accent }]}>
                <Text style={[styles.traceLabel, { color: step.accent }]}>{step.label}</Text>
                <Text style={styles.traceDetail}>{step.detail}</Text>
                <Animated.Text style={[styles.traceTime, { opacity: pulse }]}>
                  {step.time} ms
                </Animated.Text>
              </View>

              {/* connector: a thin line with a dot rather than an arrow glyph */}
              {i < steps.length - 1 && (
                <View style={styles.connector}>
                  <View style={styles.connectorLine} />
                  <View style={[styles.connectorDot, { backgroundColor: steps[i + 1].accent }]} />
                  <View style={styles.connectorLine} />
                </View>
              )}
            </React.Fragment>
          ))}
        </View>
      </ScrollView>

      {expanded && (
        <View style={styles.detail}>
          {steps.map((step, i) => {
            const share = total > 0 ? Math.round((step.time / total) * 100) : 0;
            return (
              <View key={i} style={styles.detailRow}>
                <View style={[styles.detailDot, { backgroundColor: step.accent }]} />
                <Text style={styles.detailLabel}>{step.label}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.min(share, 100)}%`, backgroundColor: step.accent },
                    ]}
                  />
                </View>
                <Text style={styles.detailTime}>
                  {step.time} ms
                </Text>
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
    fontWeight: "500",
  },
  totalTime: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 12,
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
    alignItems: "center",
  },
  traceCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: 12,
    minWidth: 150,
    borderLeftWidth: 3,
    ...shadow.sm,
  },
  traceLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 3,
  },
  traceDetail: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: "monospace",
    marginBottom: 5,
  },
  traceTime: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "monospace",
  },
  connector: {
    flexDirection: "row",
    alignItems: "center",
    width: 34,
  },
  connectorLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  connectorDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginHorizontal: 3,
  },
});
