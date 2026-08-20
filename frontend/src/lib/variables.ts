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

// header names whose value is a credential. These never reach the workspace
// blob, which on web is localStorage and survives until something clears it,
// and never reach an exported collection, which is meant to be committed.
//
// It lives here rather than in persist.ts because persist.ts pulls in
// react-native and the storage adapter, and the two things that need this most
// — the test runner and the command line runner — have neither.
const SECRET_HEADER = /^(authorization|cookie|proxy-authorization)$/i;
const SECRET_HINT = /(token|secret|password|api[-_]?key)/i;

export function isSecretHeader(name: string): boolean {
  return SECRET_HEADER.test(name.trim()) || SECRET_HINT.test(name.trim());
}

const REFERENCES_A_VARIABLE = /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/;

// Whether a header's value is the credential itself, and so must be kept out of
// anything written down.
//
// "Bearer {{token}}" is not. It is a reference, and the value behind it is
// looked after separately, where it lives. Treating the two the same emptied
// the header on every restart — the row came back with nothing in it, the
// request went out unauthenticated, and the server said "No token provided"
// about a tab that looked correctly set up.
//
// This lives here rather than in persist.ts because persist.ts pulls in
// react-native and the storage adapter, and the runner will not load either —
// which is how this went uncovered long enough to be got wrong twice.
// Headers that were named and never filled in.
//
// An enabled header with a name and no value is not a request anyone meant to
// send: "Authorization: " is the same as no Authorization at all, and the
// server answers 401 about a tab that looks correctly set up. This one cost an
// afternoon — the value had been stripped on a restart, the row survived
// looking exactly as it always had, and nothing anywhere said the header was
// empty. The app already refuses to send an unfilled :placeholder for the same
// reason, and says which one.
export function unfilledHeaders(
  headers: { key: string; value: string; enabled: boolean }[]
): string[] {
  const out: string[] = [];
  for (const h of headers || []) {
    // one the user switched off is one they decided not to send
    if (h.enabled === false) continue;
    if (!String(h.key || "").trim()) continue;
    if (String(h.value || "").trim()) continue;
    const name = String(h.key).trim();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export function holdsACredential(key: string, value: string): boolean {
  if (!key || !key.trim()) return false;
  if (!value) return false;
  if (!isSecretHeader(key)) return false;
  return !REFERENCES_A_VARIABLE.test(value);
}

export function toMap(vars: Variable[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const v of vars) {
    // a name with no value behind it counts as unset. a secret's value lives in
    // sessionStorage, so after the browser is reopened the row survives while
    // the value does not, and treating that as "" turned Bearer {{token}} into
    // a silent "Bearer " rather than something anyone could see was wrong.
    if (v.key.trim() && v.value) map[v.key.trim()] = v.value;
  }
  return map;
}

// a login answers with the one value every other request needs, and moving it
// by hand means reading it out of the body and pasting it into each tab
const TOKEN_KEYS = /^(token|accesstoken|access_token|idtoken|id_token|jwt|authtoken|auth_token)$/i;

export function findToken(data: any, depth = 0): { path: string; value: string } | null {
  if (!data || typeof data !== "object" || depth > 3) return null;

  for (const [key, value] of Object.entries(data)) {
    if (TOKEN_KEYS.test(key) && typeof value === "string" && value.length > 8) {
      return { path: key, value };
    }
  }
  // one level in is where it usually is: { data: { token } }, { auth: { jwt } }
  for (const [key, value] of Object.entries(data)) {
    const found = findToken(value, depth + 1);
    if (found) return { path: `${key}.${found.path}`, value: found.value };
  }
  return null;
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

// The Authorization header this workspace is already using.
//
// A generated request does not always carry one, and on a real API the list
// ReqFlow needs — to find a record for an :id — sits behind a login. Rather
// than invent a credential, the tabs the developer has open are read: if one of
// them authenticates, that is the token they are working with, and it is offered
// only after the server has answered 401.
//
// Nothing is guessed and nothing new is stored: this is a value already present
// in the workspace, resolved the same way sending that tab would resolve it.
export function workspaceAuth(
  tabs: { headers?: { key: string; value: string; enabled: boolean }[] }[],
  vars: Record<string, string>
): string | null {
  for (const tab of tabs) {
    for (const header of tab.headers || []) {
      // a header the developer switched off is one they decided not to send
      if (!header.enabled) continue;
      if (String(header.key).toLowerCase() !== "authorization") continue;
      const resolved = substitute(String(header.value), vars).trim();
      // an unresolved {{token}} is a placeholder, not a credential
      if (resolved && !/\{\{.*\}\}/.test(resolved)) return resolved;
    }
  }
  return null;
}
