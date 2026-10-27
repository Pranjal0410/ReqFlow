import React from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";
import Icon from "./Icon";

interface Props {
  message: string | null;
  onDismiss: () => void;
  // error is the default because that is the only thing this carried until a
  // bulk import needed to say what it did — "loaded 4" in a sidebar button
  // that reverts to its own label in under 3 seconds said nothing about
  // where those 4 requests actually went, and the tab bar gives no other
  // sign a new tab was not already sitting there.
  kind?: "error" | "success";
  // an error and a success notice are different states and rarely coincide,
  // but both default to the same spot — this lets a second instance sit
  // above the first rather than exactly on top of it on the rare tick both
  // are up
  bottom?: number;
}

// scan and request failures used to go only to console.error, so a failed
// scan looked identical to nothing happening. this surfaces them.
export default function Toast({ message, onDismiss, kind = "error", bottom }: Props) {
  const slide = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!message) return;

    Animated.timing(slide, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(onDismiss, 8000);
    return () => {
      clearTimeout(timer);
      slide.setValue(0);
    };
  }, [message, slide, onDismiss]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        bottom !== undefined && { bottom },
        {
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      <View style={[styles.toast, kind === "success" && styles.toastSuccess]}>
        <View style={styles.iconWrap}>
          {kind === "success" ? (
            <Icon name="check" size={16} color={colors.statusOk} />
          ) : (
            <Icon name="alert" size={16} color={colors.statusErr} />
          )}
        </View>
        <Text style={styles.text} numberOfLines={4}>
          {message}
        </Text>
        <Pressable
          accessibilityLabel="dismiss"
          style={({ hovered }: any) => [styles.close, hovered && styles.closeHover]}
          onPress={onDismiss}
        >
          <Icon name="close" size={14} color={colors.textDim} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    maxWidth: 560,
    backgroundColor: colors.surfaceLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.statusErr,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...shadow.md,
  },
  toastSuccess: {
    borderLeftColor: colors.statusOk,
  },
  iconWrap: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  close: {
    padding: 3,
    borderRadius: radius.sm,
    marginTop: 1,
  },
  closeHover: {
    backgroundColor: colors.hover,
  },
});
