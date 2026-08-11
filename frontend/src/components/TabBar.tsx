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
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: Props) {
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.tabRow}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <Pressable
                key={tab.id}
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
                  {tab.label || "New Request"}
                </Text>
                <TouchableOpacity
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
            style={({ hovered }: any) => [styles.newTab, hovered && styles.newTabHover]}
            onPress={onNewTab}
          >
            <Icon name="plus" size={15} color={colors.textDim} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg,
    zIndex: 2,
    ...shadow.bar,
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
