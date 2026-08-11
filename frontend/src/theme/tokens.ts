import { Platform } from "react-native";

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
};

// react native has no css transitions. on web these properties are real and
// react-native-web passes them straight through, on native they are dropped.
// press and hover states still change instantly on a phone.
export const transition = (property = "all", ms = 150) =>
  Platform.OS === "web"
    ? ({
        transitionProperty: property,
        transitionDuration: `${ms}ms`,
        transitionTimingFunction: "ease",
      } as any)
    : ({} as any);

// shadow props map to box-shadow on web and to the native equivalents
// elsewhere, so one definition covers both.
export const shadow = {
  // 0 1px 3px rgba(0,0,0,0.3)
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  // used under the tab bar so the content below feels layered
  bar: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
};

export const glow = (color: string, opacity = 0.55, r = 10) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: opacity,
  shadowRadius: r,
  elevation: 0,
});
