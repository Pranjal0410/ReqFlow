import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { radius, transition } from "../theme/tokens";
import { SubTab } from "../types";

interface TabInfo {
  key: SubTab;
  label: string;
  count?: number;
  hasDot?: boolean;
}

interface Props {
  activeSubTab: SubTab;
  onSelect: (tab: SubTab) => void;
  headerCount: number;
  hasBody: boolean;
}

export default function SubTabs({ activeSubTab, onSelect, headerCount, hasBody }: Props) {
  const tabs: TabInfo[] = [
    { key: "params", label: "Params" },
    { key: "headers", label: "Headers", count: headerCount },
    { key: "body", label: "Body", hasDot: hasBody },
    { key: "auth", label: "Auth" },
    { key: "prerequest", label: "Pre-request" },
    { key: "tests", label: "Tests" },
  ];

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = activeSubTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            style={({ hovered }: any) => [
              styles.tab,
              hovered && !active && styles.tabHover,
              active && styles.activeTab,
            ]}
            onPress={() => onSelect(tab.key)}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
            {tab.count !== undefined && tab.count > 0 && (
              <Text style={styles.count}>({tab.count})</Text>
            )}
            {tab.hasDot && <View style={styles.dot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    paddingHorizontal: 12,
    backgroundColor: colors.bg,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    ...transition("background-color, border-bottom-color, color"),
  },
  tabHover: {
    backgroundColor: colors.hover,
  },
  activeTab: {
    borderBottomColor: colors.accent,
  },
  label: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: "500",
  },
  activeLabel: {
    color: colors.text,
  },
  count: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "500",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginLeft: 2,
  },
});
