import { highlight, highlightLines } from "../highlight";
import { colors } from "../../theme/colors";

// what colour a given piece of the source came out as
const colourOf = (source: string, text: string) =>
  highlight(source).find((t) => t.text === text)?.color;

describe("highlight", () => {
  it("reassembles the source exactly", () => {
    const source = `const x = "a"; // note\nfn(1)`;
    expect(highlight(source).map((t) => t.text).join("")).toBe(source);
  });

  it("colours keywords, strings, numbers and comments apart", () => {
    const source = `const total = 42; // sum\nconst name = "ada";`;
    expect(colourOf(source, "const")).toBe(colors.syntax.keyword);
    expect(colourOf(source, "42")).toBe(colors.syntax.number);
    expect(colourOf(source, "// sum")).toBe(colors.syntax.comment);
    expect(colourOf(source, '"ada"')).toBe(colors.syntax.string);
  });

  it("marks a name as a call only when a bracket follows", () => {
    const source = `res.json(payload)`;
    expect(colourOf(source, "json")).toBe(colors.syntax.call);
    expect(colourOf(source, "payload")).toBe(colors.syntax.plain);
  });

  // the two failure modes of a lexer this small, and the reason comments and
  // strings are matched before anything else
  it("does not start a comment inside a string", () => {
    const source = `const url = "http://localhost:3000";`;
    expect(colourOf(source, `"http://localhost:3000"`)).toBe(colors.syntax.string);
    expect(highlight(source).some((t) => t.color === colors.syntax.comment)).toBe(false);
  });

  it("does not start a string inside a comment", () => {
    const source = `// don't do this\nconst x = 1;`;
    expect(colourOf(source, "// don't do this")).toBe(colors.syntax.comment);
    expect(highlight(source).some((t) => t.color === colors.syntax.string)).toBe(false);
  });

  it("keeps a block comment together across lines", () => {
    const source = `/* one\n   two */\nconst x = 1;`;
    expect(colourOf(source, "/* one\n   two */")).toBe(colors.syntax.comment);
  });
});

describe("highlightLines", () => {
  it("splits into one entry per line", () => {
    expect(highlightLines(`a\nb\nc`)).toHaveLength(3);
  });

  it("keeps a multi-line token coloured on every line it covers", () => {
    const lines = highlightLines(`/* one\n   two */`);
    expect(lines).toHaveLength(2);
    expect(lines[0][0].color).toBe(colors.syntax.comment);
    expect(lines[1][0].color).toBe(colors.syntax.comment);
  });

  it("preserves a blank line rather than dropping it", () => {
    expect(highlightLines(`a\n\nb`)).toHaveLength(3);
  });
});
