// Taking a value out of one response so the next request can use it.
//
// Almost nothing on a real API can be called on its own. Creating an incident
// answers with its id, and every request after that needs the id; logging in
// answers with a token, and every request after that needs the token. Without
// somewhere to put those, the developer reads the value off the screen and
// pastes it into the next tab, and does it again the next time the id changes.
//
// A login was already handled, by name, in variables.ts — it looks for a field
// that is called something like "token" and saves it as {{token}}. That covers
// the one case the app could guess. This is the rest of them: the user says
// which field, and what to call it, and it happens on every send after that.

import { ApiResponse } from "../types";

export interface Capture {
  id: string;
  // where the value is in the response body, written the way it reads in the
  // body itself: "token", "data.id", "items.0.id"
  from: string;
  // the variable it becomes, used as {{name}} anywhere in any tab
  name: string;
  // what it picked up last time. Kept so the rule can be seen working: a rule
  // that silently does nothing looks exactly like a rule that is not there.
  lastValue: string | null;
}

// One step of the path. An array is indexed by number, an object by name, and
// anything else has no way down.
function step(value: any, key: string): any {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const index = Number(key);
    return Number.isInteger(index) ? value[index < 0 ? value.length + index : index] : undefined;
  }
  return typeof value === "object" ? value[key] : undefined;
}

function walk(body: any, parts: string[]): any {
  let at = body;
  for (const part of parts) {
    at = step(at, part);
    if (at === undefined) return undefined;
  }
  return at;
}

// A variable is text that goes into a URL, a header or a body. A whole object
// has no reading as text that anyone would want — "[object Object]" in a URL is
// not a value, it is a bug that took a while to find — so only the things that
// spell themselves count.
function asValue(found: any): string | null {
  if (typeof found === "string") return found;
  if (typeof found === "number" || typeof found === "boolean") return String(found);
  return null;
}

// Where the value is, given how people actually write it down.
//
// Bodies are wrapped about half the time — { data: { id } } — and which half
// you are in is not something worth being strict about. So "data.id" finds it
// in a body that has no data wrapper, and "id" finds it in one that does. Being
// right about the field and wrong about the envelope is not a mistake worth
// answering with nothing.
export function valueAt(body: any, path: string): string | null {
  const trimmed = String(path || "").trim();
  if (!trimmed || body === null || body === undefined) return null;

  const parts = trimmed.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const direct = asValue(walk(body, parts));
  if (direct !== null) return direct;

  // written with the wrapper, sent without it
  if (parts[0] === "data") {
    const withoutWrapper = asValue(walk(body, parts.slice(1)));
    if (withoutWrapper !== null) return withoutWrapper;
  }

  // written without the wrapper, sent with it
  const inWrapper = asValue(walk(body, ["data", ...parts]));
  if (inWrapper !== null) return inWrapper;

  return null;
}

export interface Captured {
  name: string;
  value: string;
}

// What this response gives up, for the rules on the tab that sent it.
//
// Only from a response the server was happy with. A failure body often echoes
// the shape of a success — an error object with an id in it, a 401 whose body
// mentions a token — and letting one of those overwrite a value that is working
// turns one failed request into a run of them. The same reason the login
// capture only fires on success.
export function runCaptures(captures: Capture[], response: ApiResponse | null): Captured[] {
  if (!response || response.status < 200 || response.status >= 300) return [];

  const out: Captured[] = [];
  for (const rule of captures || []) {
    const name = String(rule.name || "").trim();
    if (!name) continue;

    const value = valueAt(response.data, rule.from);
    if (value === null) continue;

    // last rule wins, the same way the last assignment wins anywhere else
    const existing = out.findIndex((c) => c.name === name);
    if (existing >= 0) out[existing] = { name, value };
    else out.push({ name, value });
  }
  return out;
}

// The rules, with what they just picked up written back into them, so the panel
// can show the value beside the rule that found it. Rules that found nothing
// this time are left holding what they found last time rather than being
// cleared: the value is still the one in use.
export function withResults(captures: Capture[], found: Captured[]): Capture[] {
  return (captures || []).map((rule) => {
    const hit = found.find((f) => f.name === String(rule.name || "").trim());
    return hit ? { ...rule, lastValue: hit.value } : rule;
  });
}

// What a response offers, for someone who has not written a rule yet.
//
// Reading a path out of a body by eye is the part that goes wrong — "data.id"
// against a body that is a bare array, a name that is nearly right. These are
// paths taken from the body in front of them, so the first rule can be made
// with one press instead of being typed from memory.
export function suggestions(body: any, limit = 6): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];

  const visit = (node: any, prefix: string, depth: number) => {
    if (out.length >= limit || node === null || node === undefined || depth > 3) return;

    if (Array.isArray(node)) {
      // the first element stands for the list: offering the same field at
      // twenty indexes is a longer list saying one thing
      if (node.length > 0) visit(node[0], prefix ? `${prefix}.0` : "0", depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (out.length >= limit) return;
      const path = prefix ? `${prefix}.${key}` : key;
      const flat = asValue(value);
      // an identifier is what a later request needs; a description is not
      if (flat !== null && /(^|[._-])(id|_id|uuid|slug|key|token|code|name)$/i.test(key)) {
        out.push({ path, value: flat });
      }
    }
    // one level down only after the level above has been offered, so the
    // shallow paths — the ones people mean — come first
    for (const [key, value] of Object.entries(node)) {
      if (out.length >= limit) return;
      if (value && typeof value === "object") {
        visit(value, prefix ? `${prefix}.${key}` : key, depth + 1);
      }
    }
  };

  visit(body, "", 0);
  return out;
}

// A name that can be written as {{name}} and read back. Anything else silently
// never resolves, which reads as the capture having failed.
export function isUsableName(name: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(String(name || "").trim());
}
