import React from "react";
import Svg, { Path, Circle, Polyline } from "react-native-svg";
import { colors } from "../theme/colors";

// stroke icons instead of emoji and typographic glyphs. emoji render
// differently per platform and cannot be recoloured or aligned properly.
export type IconName =
  | "close"
  | "plus"
  | "send"
  | "arrowRight"
  | "chevronDown"
  | "check"
  | "circle"
  | "x"
  | "clock"
  | "weight"
  | "sparkle"
  | "search"
  | "alert";

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

export default function Icon({ name, size = 16, color = colors.textDim }: Props) {
  const common = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "close" && (
        <>
          <Path d="M18 6 6 18" {...common} />
          <Path d="m6 6 12 12" {...common} />
        </>
      )}
      {name === "plus" && (
        <>
          <Path d="M12 5v14" {...common} />
          <Path d="M5 12h14" {...common} />
        </>
      )}
      {(name === "send" || name === "arrowRight") && (
        <>
          <Path d="M5 12h14" {...common} />
          <Path d="m12 5 7 7-7 7" {...common} />
        </>
      )}
      {name === "chevronDown" && <Path d="m6 9 6 6 6-6" {...common} />}
      {name === "check" && <Path d="M20 6 9 17l-5-5" {...common} />}
      {name === "circle" && <Circle cx="12" cy="12" r="7" {...common} />}
      {name === "x" && (
        <>
          <Path d="M18 6 6 18" {...common} />
          <Path d="m6 6 12 12" {...common} />
        </>
      )}
      {name === "clock" && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Polyline points="12 7 12 12 15 14" {...common} />
        </>
      )}
      {name === "weight" && (
        <>
          <Path d="M4 7h16" {...common} />
          <Path d="M4 12h16" {...common} />
          <Path d="M4 17h10" {...common} />
        </>
      )}
      {name === "sparkle" && (
        <Path
          d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
          {...common}
        />
      )}
      {name === "search" && (
        <>
          <Circle cx="11" cy="11" r="7" {...common} />
          <Path d="m20 20-3.5-3.5" {...common} />
        </>
      )}
      {name === "alert" && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M12 8v5" {...common} />
          <Path d="M12 16h.01" {...common} />
        </>
      )}
    </Svg>
  );
}
