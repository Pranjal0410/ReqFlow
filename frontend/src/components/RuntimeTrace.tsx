import React from "react";
import { View, Text, ScrollView, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";

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

export default function RuntimeTrace({ response, method, url }: Props) {
  // hooks must run on every render, so the pulse is set up before the
  // early return below
  const pulse = React.useRef(new Animated.Value(1)).current;

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

  const steps: TraceStep[] = [
    {
      label: "HTTP Request",
      detail: `${method} ${new URL(url).pathname}`,
      time: total,
      accent: colors.traceRequest,
    },
    {
      label: "Server Processing",
      detail: "request handled",
      time: Math.round(total * 0.7),
      accent: colors.traceProcessing,
    },
    {
      label: "Response",
      detail: `${response.status} ${response.statusText}`,
      time: Math.round(total * 0.1),
      accent: colors.traceResponse,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Runtime Trace</Text>
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
