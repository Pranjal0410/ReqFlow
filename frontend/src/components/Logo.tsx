import React from "react";
import Svg, { Path } from "react-native-svg";
import { colors } from "../theme/colors";

// The one mark, drawn once. The same geometry is in assets/logo/mark.svg, which
// is what the favicon and every app icon are generated from — a header that drew
// its own version would be a second logo pretending to be the first.
//
// A request sets off, travels, dips, and comes back up as a check: a change is
// not finished when it is written, it is finished when something has answered.
export default function Logo({
  size = 20,
  color = colors.text,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12h6.4l3.1 4.4L21 7.4"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
