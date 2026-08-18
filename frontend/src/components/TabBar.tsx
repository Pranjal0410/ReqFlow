import React from "react";
import { View, Text, Pressable, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow, transition } from "../theme/tokens";
import Icon from "./Icon";
import { RequestTab } from "../types";

interface Props {
  tabs: RequestTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onCloseOthers: () => void;
  onRunAll: () => void;
  runProgress: { done: number; total: number } | null;
  runSummary: { passed: number; failed: number; errors: number; sent: number } | null;
}

// a run of nested routes gives every tab a label ending in the same 24 hex
// characters, and the row truncates at the end, so they all read alike. the id
// is what makes them different, so keep both ends of it.
function shortenIds(label: string): string {
  return label.replace(/\b([0-9a-f]{8})[0-9a-f]{8,}([0-9a-f]{4})\b/gi, "$1…$2");
}

// The method already has its own coloured badge to the left, so a label that
// starts with it says the same thing twice — "POST  POST /api/users" — on every
// tab, in the row that has the least width to spare.
function withoutMethod(label: string): string {
  return label.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, "");
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onCloseOthers,
  onRunAll,
  runProgress,
  runSummary,
}: Props) {
  const runnable = tabs.filter((t) => t.url.trim()).length;
  const scrollRef = React.useRef<ScrollView>(null);
  const layouts = React.useRef<Record<string, { x: number; width: number }>>({});
  const scrollX = React.useRef(0);
  const viewport = React.useRef(0);

  // the agent opens a tab per request and selects the last one, which sits off
  // the right edge once there are a few. without this the user reads a response
  // whose tab they cannot see, and has to scroll around to find what is
  // selected.
  const ensureVisible = React.useCallback((id: string) => {
    const box = layouts.current[id];
    if (!box || !viewport.current) return;

    const pad = 12;
    const left = scrollX.current;
    const right = left + viewport.current;

    if (box.x < left) {
      scrollRef.current?.scrollTo({ x: Math.max(0, box.x - pad), animated: true });
    } else if (box.x + box.width > right) {
      scrollRef.current?.scrollTo({
        x: box.x + box.width - viewport.current + pad,
        animated: true,
      });
    }
  }, []);

  // a tab added in this render has not been measured yet when the effect runs,
  // so the scroll is also attempted from the tab's own onLayout below
  React.useEffect(() => {
    ensureVisible(activeTabId);
  }, [activeTabId, tabs.length, ensureVisible]);

  return (
    <View
      style={styles.container}
      // only a fallback for a tab that measures itself before the scroller
      // does. the scroller's own width is the accurate one, since this row also
      // holds the button on the right.
      onLayout={(e) => {
        if (!viewport.current) viewport.current = e.nativeEvent.layout.width;
      }}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollX.current = e.nativeEvent.contentOffset.x;
        }}
        onLayout={(e) => {
          viewport.current = e.nativeEvent.layout.width;
        }}
      >
        <View style={styles.tabRow}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <Pressable
                key={tab.id}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  layouts.current[tab.id] = { x, width };
                  if (active) ensureVisible(tab.id);
                }}
                style={({ hovered }: any) => [
                  styles.tab,
                  !active && styles.tabInactive,
                  hovered && !active && styles.tabHover,
                  active && styles.activeTab,
                ]}
                onPress={() => onSelectTab(tab.id)}
              >
                <Text
                  style={[
                    styles.methodLabel,
                    { color: (colors.method as any)[tab.method] || colors.text },
                  ]}
                >
                  {tab.method}
                </Text>
                <Text
                  style={[styles.tabLabel, active && styles.tabLabelActive]}
                  numberOfLines={1}
                >
                  {withoutMethod(shortenIds(tab.label || "New Request"))}
                </Text>
                <TouchableOpacity
                  accessibilityLabel="close this tab"
                  style={styles.closeBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <Icon name="close" size={13} color={colors.textDim} />
                </TouchableOpacity>
              </Pressable>
            );
          })}

          <Pressable
            accessibilityLabel="new request tab"
            style={({ hovered }: any) => [styles.newTab, hovered && styles.newTabHover]}
            onPress={onNewTab}
          >
            <Icon name="plus" size={15} color={colors.textDim} />
          </Pressable>
        </View>
      </ScrollView>

      {/* the agent opens a tab per request, so a few runs leave a row nobody
          wants to close one at a time. pinned outside the scroller so it does
          not drift off with the tabs. */}
      {/* nothing to run means the button did nothing when pressed, with no
          explanation. it stays out of the way until there is. the result goes
          on the button too, rather than as a second thing competing for the
          same strip. */}
      {(runnable > 0 || runProgress) && (
        <Pressable
          style={({ hovered }: any) => [
            styles.closeOthers,
            hovered && styles.closeOthersHover,
            !!runProgress && styles.runningBtn,
          ]}
          onPress={onRunAll}
          disabled={!!runProgress}
        >
          {runProgress ? (
            <Text style={styles.closeOthersText}>
              running {runProgress.done}/{runProgress.total}
            </Text>
          ) : runSummary ? (
            <Text style={styles.closeOthersText}>
              {/* with no assertions anywhere, "0 passed" reads as a failure */}
              {runSummary.passed + runSummary.failed === 0 ? (
                <Text>{runSummary.sent} sent, no assertions</Text>
              ) : (
                <>
                  <Text style={{ color: colors.statusOk }}>{runSummary.passed} passed</Text>
                  {runSummary.failed > 0 && (
                    <Text style={{ color: colors.statusErr }}> · {runSummary.failed} failed</Text>
                  )}
                </>
              )}
              {runSummary.errors > 0 && <Text> · {runSummary.errors} not sent</Text>}
            </Text>
          ) : (
            <Text style={styles.closeOthersText}>Run all ({runnable})</Text>
          )}
        </Pressable>
      )}

      {tabs.length > 2 && (
        <Pressable
          style={({ hovered }: any) => [styles.closeOthers, hovered && styles.closeOthersHover]}
          onPress={onCloseOthers}
        >
          <Text style={styles.closeOthersText}>Close others</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    zIndex: 2,
    ...shadow.bar,
  },
  scroller: {
    flex: 1,
    // without this a flex item refuses to shrink below its content, so the tab
    // row runs on underneath the button instead of scrolling
    minWidth: 0,
  },
  closeOthers: {
    marginLeft: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...transition("background-color"),
  },
  closeOthersHover: {
    backgroundColor: colors.hover,
  },
  runningBtn: {
    borderColor: colors.accent,
  },
  closeOthersText: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "500",
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 200,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    ...transition("background-color, opacity, border-bottom-color"),
  },
  tabInactive: {
    opacity: 0.6,
  },
  tabHover: {
    backgroundColor: colors.hover,
    opacity: 0.85,
  },
  activeTab: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.accent,
  },
  methodLabel: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "monospace",
  },
  tabLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "500",
    maxWidth: 120,
  },
  tabLabelActive: {
    color: colors.text,
  },
  closeBtn: {
    marginLeft: 4,
    padding: 2,
    borderRadius: radius.sm,
    ...transition("background-color"),
  },
  closeText: {
    color: colors.textDim,
    fontSize: 16,
    lineHeight: 16,
  },
  newTab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    ...transition("background-color"),
  },
  newTabHover: {
    backgroundColor: colors.hover,
  },
  newTabText: {
    color: colors.textDim,
    fontSize: 18,
    fontWeight: "500",
  },
});
