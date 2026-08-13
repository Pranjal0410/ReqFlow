// {{name}} placeholders, resolved just before a request goes out. the token the
// agent gets from a login otherwise lives in whichever tab happened to fetch
// it, and every other tab has to log in again.

export interface Variable {
  key: string;
  value: string;
}

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

// a variable holding a credential is kept out of the workspace blob, the same
// way an Authorization header is
const SECRET_NAME = /(token|secret|password|api[-_]?key|auth)/i;

export function isSecretVariable(name: string): boolean {
  return SECRET_NAME.test(name.trim());
}

export function toMap(vars: Variable[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const v of vars) {
    if (v.key.trim()) map[v.key.trim()] = v.value;
  }
  return map;
}

export function substitute(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  // an unknown name is left as written rather than blanked, so a typo shows up
  // in the request instead of silently becoming an empty string
  return text.replace(TOKEN, (whole, name) => (name in vars ? vars[name] : whole));
}

// names used in the text that have no value behind them
export function missingIn(text: string, vars: Record<string, string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    if (!(m[1] in vars) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
