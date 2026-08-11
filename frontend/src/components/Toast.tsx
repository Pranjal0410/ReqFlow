import React from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme/colors";
import { radius, shadow } from "../theme/tokens";
import Icon from "./Icon";

interface Props {
  message: string | null;
  onDismiss: () => void;
}

// scan and request failures used to go only to console.error, so a failed
// scan looked identical to nothing happening. this surfaces them.
export default function Toast({ message, onDismiss }: Props) {
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
        {
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      <View style={styles.toast}>
        <View style={styles.iconWrap}>
          <Icon name="alert" size={16} color={colors.statusErr} />
        </View>
        <Text style={styles.text} numberOfLines={4}>
          {message}
        </Text>
        <Pressable
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
