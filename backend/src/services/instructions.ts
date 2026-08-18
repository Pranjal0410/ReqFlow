// Standing instructions: the things a developer would otherwise retype at the
// start of every request. "camelCase, not snake_case", "validate with zod",
// "errors as { error: message }". They are held by the frontend and sent with
// each call, rather than kept here, because they belong to the workspace the
// user can see and edit — an instruction the app is following that the user
// cannot find is worse than one they have to repeat.
//
// Everything sent is used. There is no relevance ranking picking a subset,
// because the checklist claims to show what the model is following, and a claim
// like that has to be the real list rather than a guess about which ones
// mattered this time.

export interface Instruction {
  id: string;
  text: string;
}

// One instruction is a sentence, not a document. The cap is on what reaches the
// prompt: a pasted style guide would crowd out the project's own files, which
// are the better evidence of how the project writes code.
export const MAX_INSTRUCTIONS = 20;
export const MAX_INSTRUCTION_CHARS = 300;

export function coerceInstructions(raw: any): Instruction[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: Instruction[] = [];

  for (const item of raw) {
    // A rule the user switched off is dropped here, at the boundary where
    // whatever was sent becomes the type the rest of the code trusts. It used to
    // be dropped nowhere: this function kept only id and text, so `enabled` was
    // gone before anything could honour it, and every filter downstream saw a
    // rule with no flag and treated it as on.
    if (item?.enabled === false) continue;

    const text = String(item?.text ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;

    // the same instruction twice is one instruction said twice
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ id: String(item?.id ?? key), text: text.slice(0, MAX_INSTRUCTION_CHARS) });
    if (out.length >= MAX_INSTRUCTIONS) break;
  }

  return out;
}

// Named as the user's own standing rules rather than as extra system prompt, so
// the model treats a conflict with its defaults as the user having already
// decided. They do not override the project's real files: a project that writes
// snake_case everywhere is evidence, and an instruction is intent, so the
// instruction wins only where the two actually disagree.
export function formatInstructions(list: Instruction[]): string {
  if (list.length === 0) return "";

  return `The user has standing instructions for this workspace. They said these once and should not have to repeat them. Follow every one of them without being asked, and without mentioning that you are doing so:

${list.map((i) => `- ${i.text}`).join("\n")}

Where one of these disagrees with the style of the project's own files, follow the instruction: the files show what the project has done, the instruction is what the user wants done now.`;
}
