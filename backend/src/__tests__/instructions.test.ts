import {
  coerceInstructions,
  formatInstructions,
  MAX_INSTRUCTIONS,
  MAX_INSTRUCTION_CHARS,
} from "../services/instructions";
import { rememberInstruction, UiAction, ActionLogEntry } from "../routes/aiChat";

describe("coerceInstructions", () => {
  it("keeps the text and normalises whitespace", () => {
    expect(coerceInstructions([{ id: "a", text: "  Use   camelCase\nfor fields " }])).toEqual([
      { id: "a", text: "Use camelCase for fields" },
    ]);
  });

  it("drops empties and anything that is not a list", () => {
    expect(coerceInstructions([{ text: "   " }, { text: "" }, null])).toEqual([]);
    expect(coerceInstructions("camelCase")).toEqual([]);
    expect(coerceInstructions(undefined)).toEqual([]);
  });

  // the same rule said twice is one rule, and sending it twice only makes the
  // prompt longer
  it("collapses duplicates regardless of case", () => {
    const out = coerceInstructions([
      { id: "1", text: "Use camelCase" },
      { id: "2", text: "use CAMELCASE" },
    ]);
    expect(out).toHaveLength(1);
  });

  // a pasted style guide would crowd out the project's own files, which are the
  // better evidence of how this project writes code
  it("caps how much can reach the prompt", () => {
    const many = Array.from({ length: MAX_INSTRUCTIONS + 5 }, (_, i) => ({
      id: `${i}`,
      text: `rule ${i}`,
    }));
    expect(coerceInstructions(many)).toHaveLength(MAX_INSTRUCTIONS);

    const long = coerceInstructions([{ id: "x", text: "a".repeat(1000) }]);
    expect(long[0].text).toHaveLength(MAX_INSTRUCTION_CHARS);
  });
});

describe("formatInstructions", () => {
  it("says nothing at all when there is nothing to say", () => {
    expect(formatInstructions([])).toBe("");
  });

  it("lists every rule it was given", () => {
    const text = formatInstructions([
      { id: "1", text: "Use camelCase" },
      { id: "2", text: "Validate with zod" },
    ]);
    expect(text).toContain("- Use camelCase");
    expect(text).toContain("- Validate with zod");
  });
});

describe("rememberInstruction", () => {
  const run = (args: any, existing: { id: string; text: string }[] = []) => {
    const uiActions: UiAction[] = [];
    const log: ActionLogEntry[] = [];
    const out: any = rememberInstruction(args, uiActions, log, existing);
    return { out, uiActions, log };
  };

  it("saves a rule and logs it", () => {
    const { out, uiActions, log } = run({ text: "Use camelCase for JSON fields" });
    expect(out.ok).toBe(true);
    expect(uiActions).toEqual([
      { type: "remember_instruction", text: "Use camelCase for JSON fields" },
    ]);
    expect(log).toEqual([{ kind: "instruction", text: "Use camelCase for JSON fields" }]);
  });

  // a repeat costs no action and adds no second copy, the same way a duplicate
  // request tab is collapsed
  it("does not save one the workspace already has", () => {
    const { out, uiActions, log } = run({ text: "use camelcase" }, [
      { id: "1", text: "Use camelCase" },
    ]);
    expect(out.duplicate).toBe(true);
    expect(uiActions).toHaveLength(0);
    expect(log).toHaveLength(0);
  });

  it("does not save the same rule twice in one turn", () => {
    const uiActions: UiAction[] = [];
    const log: ActionLogEntry[] = [];
    rememberInstruction({ text: "Use zod" }, uiActions, log, []);
    const second: any = rememberInstruction({ text: "Use zod" }, uiActions, log, []);
    expect(second.duplicate).toBe(true);
    expect(uiActions).toHaveLength(1);
  });

  it("refuses an empty rule and an essay", () => {
    expect(run({ text: "   " }).out.error).toBeTruthy();
    expect(run({ text: "a".repeat(MAX_INSTRUCTION_CHARS + 1) }).out.error).toBeTruthy();
  });

  it("refuses once the workspace is full", () => {
    const full = Array.from({ length: MAX_INSTRUCTIONS }, (_, i) => ({
      id: `${i}`,
      text: `rule ${i}`,
    }));
    const { out, uiActions } = run({ text: "one more" }, full);
    expect(out.error).toContain(`${MAX_INSTRUCTIONS}`);
    expect(uiActions).toHaveLength(0);
  });
});

// The panel tells the user "everything switched on is sent with every request".
// That is a claim about what the thing that sends does, and it should be true of
// that, not of one caller that happens to filter first.
describe("instructions the user switched off", () => {
  const rules = [
    { id: "i1", text: "Use camelCase for JSON field names", enabled: true },
    { id: "i2", text: "Never use var", enabled: false },
  ] as any;

  it("does not put a switched-off rule in the prompt", () => {
    const prompt = formatInstructions(coerceInstructions(rules));
    expect(prompt).toContain("camelCase");
    expect(prompt).not.toContain("Never use var");
  });

  it("says nothing at all when every rule is off", () => {
    expect(formatInstructions(coerceInstructions([{ id: "i", text: "x", enabled: false }]))).toBe("");
  });

  it("never reports a switched-off rule as having been sent", () => {
    // the panel marks a rule "in the last request" from this list
    expect(coerceInstructions(rules).map((i) => i.id)).toEqual(["i1"]);
  });

  it("treats a rule with no flag as on, which is how older ones are stored", () => {
    expect(formatInstructions(coerceInstructions([{ id: "i", text: "keep me" }]))).toContain("keep me");
  });
});
