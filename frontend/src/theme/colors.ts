export const colors = {
  // neutral near black, no blue or purple cast
  bg: "#0a0a0a",
  surface: "#111113",
  surfaceLight: "#18181a",
  border: "#1f1f22",

  text: "#ededf0",
  // mid tone for content that has to stay readable, e.g. endpoint paths
  textMuted: "#a1a1aa",
  textDim: "#808090", // 5.1:1 on bg, #6b6b75 was 3.76:1 and failed AA

  // primary actions are light on dark, like the Declare button in the reference
  accent: "#ededf0",
  accentLight: "#ffffff",
  accentDim: "rgba(255, 255, 255, 0.08)",
  hover: "rgba(255, 255, 255, 0.08)",

  // semantic colours carry all the meaning
  method: {
    GET: "#60a5fa",
    POST: "#4ade80",
    PUT: "#f5a524",
    DELETE: "#f87171",
    PATCH: "#22d3ee",
  },
  statusOk: "#4ade80",
  statusErr: "#f87171",
  warning: "#f5a524",
  info: "#60a5fa",

  // json bodies read better in a soft mint than in plain white
  code: "#8ee7b8",

  // runtime trace step accents, mirroring the stat card bars in the reference
  traceRequest: "#4ade80",
  traceProcessing: "#60a5fa",
  traceResponse: "#f5a524",
};
