import React from "react";
import { Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

interface Props {
  data: any;
  // raw shows the unformatted payload exactly as it came back
  raw?: boolean;
}

type Token = { text: string; color: string };

// splits pretty printed json into strings, numbers, literals and punctuation.
// a key is just a string that is followed by a colon.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function tokenize(json: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(json)) !== null) {
    if (m.index > last) {
      out.push({ text: json.slice(last, m.index), color: colors.json.punctuation });
    }

    const [full, str, colon, bool] = m;

    if (str !== undefined) {
      // a trailing colon means this string was a key
      out.push({ text: str, color: colon ? colors.json.key : colors.json.string });
      if (colon) out.push({ text: colon, color: colors.json.punctuation });
    } else if (bool !== undefined) {
      out.push({ text: full, color: colors.json.boolean });
    } else if (full === "null") {
      out.push({ text: full, color: colors.json.null });
    } else {
      out.push({ text: full, color: colors.json.number });
    }

    last = m.index + full.length;
  }

  if (last < json.length) {
    out.push({ text: json.slice(last), color: colors.json.punctuation });
  }
  return out;
}

export default function JsonView({ data, raw }: Props) {
  const text = React.useMemo(() => {
    if (typeof data === "string") return data;
    try {
      return raw ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data, raw]);

  // non json payloads, e.g. the html express returns for an unknown route
  const looksLikeJson = typeof data !== "string";

  const tokens = React.useMemo(
    () => (looksLikeJson ? tokenize(text) : null),
    [text, looksLikeJson]
  );

  if (!tokens) {
    return <Text style={styles.plain}>{text}</Text>;
  }

  return (
    <Text style={styles.mono}>
      {tokens.map((t, i) => (
        <Text key={i} style={{ color: t.color }}>
          {t.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  mono: {
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
  plain: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
});
