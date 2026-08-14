import { colors } from "../theme/colors";

// Generated code is read before it is trusted, and unhighlighted code is read
// slowly. This is the same shape as the json tokenizer next door: enough of a
// lexer to colour javascript and typescript, and no more. It is not a parser
// and does not need to be, because nothing here depends on being right about
// the grammar, only about which run of characters gets which colour.

export interface CodeToken {
  text: string;
  color: string;
}

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "default", "delete", "do", "else", "export", "extends", "finally", "for",
  "from", "function", "if", "import", "in", "instanceof", "let", "new", "of",
  "return", "static", "super", "switch", "this", "throw", "try", "typeof",
  "var", "void", "while", "yield",
  // typescript, since half the projects this runs against are in it
  "as", "declare", "enum", "implements", "interface", "keyof", "namespace",
  "private", "protected", "public", "readonly", "type",
  // literals read as keywords rather than as identifiers
  "true", "false", "null", "undefined",
]);

// Order matters and is the whole design: a // inside a string must not start a
// comment, and a quote inside a comment must not start a string. Whichever
// alternative matches earliest in the source wins, and both of those are
// consumed whole, so neither can begin inside the other.
const TOKEN = new RegExp(
  [
    "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)", // 1 comment
    "('(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|`(?:\\\\[\\s\\S]|[^`\\\\])*`)", // 2 string
    "(\\b\\d[\\w.]*)", // 3 number
    "([A-Za-z_$][\\w$]*)", // 4 word
  ].join("|"),
  "g"
);

export function highlight(source: string): CodeToken[] {
  const out: CodeToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(source)) !== null) {
    if (m.index > last) {
      out.push({ text: source.slice(last, m.index), color: colors.syntax.plain });
    }

    const [full, comment, str, num, word] = m;

    if (comment !== undefined) {
      out.push({ text: full, color: colors.syntax.comment });
    } else if (str !== undefined) {
      out.push({ text: full, color: colors.syntax.string });
    } else if (num !== undefined) {
      out.push({ text: full, color: colors.syntax.number });
    } else if (KEYWORDS.has(word)) {
      out.push({ text: full, color: colors.syntax.keyword });
    } else {
      // a name with a ( after it is being called, which is what the eye looks
      // for when skimming an unfamiliar file
      const after = source.slice(m.index + full.length);
      const called = /^\s*\(/.test(after);
      out.push({ text: full, color: called ? colors.syntax.call : colors.syntax.plain });
    }

    last = m.index + full.length;
  }

  if (last < source.length) {
    out.push({ text: source.slice(last), color: colors.syntax.plain });
  }
  return out;
}

// Long generated files render as one enormous Text run, which react-native-web
// happily does but which makes line numbers impossible. Splitting on newlines
// after tokenizing keeps a token that spans lines, a block comment or a
// template literal, correctly coloured on every line it covers.
export function highlightLines(source: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]];

  for (const token of highlight(source)) {
    const parts = token.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, color: token.color });
    });
  }

  return lines;
}
