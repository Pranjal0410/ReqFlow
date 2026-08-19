// A scanned route arrives as /api/incidents/:id, and clicking it used to hand
// you that url verbatim. The placeholder stays in the tab so the row can be
// edited again, and the value is substituted on the way out, the same way
// {{variables}} are.

import { substitute } from "./variables";

export const PATH_PARAM = /:([A-Za-z0-9_]+)/g;

export function namesIn(url: string): string[] {
  const out: string[] = [];
  for (const m of url.matchAll(PATH_PARAM)) {
    // a port is not a path parameter: :3001 never starts with a letter
    if (/^[A-Za-z_]/.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// The comment at the top of this file said the value was substituted the same
// way {{variables}} are. It was not: {{ }} was resolved in the url, the headers
// and the body, and never in the value filled in for a placeholder — which is
// the one place a captured id is most likely to be typed. It went out encoded,
// as %7B%7Bid%7D%7D, and the server answered with something about a malformed
// id that named nothing anyone had written.
export function applyPathParams(
  url: string,
  values: Record<string, string>,
  vars: Record<string, string> = {}
): string {
  return url.replace(PATH_PARAM, (whole, name) => {
    if (!/^[A-Za-z_]/.test(name)) return whole;
    const raw = values[name];
    if (!raw) return whole;

    const value = substitute(raw, vars);
    // a name with nothing behind it stays a placeholder. Encoding the braces
    // and sending them is how this went wrong in the first place.
    if (/\{\{.*\}\}/.test(value)) return whole;

    // an unfilled one is left as written, so the request fails somewhere
    // obvious instead of silently hitting /api/incidents//notes
    return encodeURIComponent(value);
  });
}

// which of a url's placeholders still have nothing behind them
export function unfilled(url: string, values: Record<string, string>): string[] {
  return namesIn(url).filter((n) => !values[n]);
}

// Does this concrete url fill in that template, and with what?
//
// The agent drafts a tab holding /api/incidents/:id/commander, and ReqFlow then
// runs /api/incidents/6a7e.../commander against a real record. Compared as
// strings those are different urls, so the response landed in a new tab — or
// nowhere — and the drafted tab sat there saying "No response yet" about a
// request that had just been made on its behalf.
export function matchTemplate(
  template: string,
  concrete: string
): Record<string, string> | null {
  const a = template.split("/");
  const b = concrete.split("/");
  if (a.length !== b.length) return null;

  const values: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) {
      if (!b[i]) return null;
      values[a[i].slice(1)] = decodeURIComponent(b[i]);
      continue;
    }
    if (a[i] !== b[i]) return null;
  }

  // an identical pair is not a template being filled in, and treating it as one
  // would have every tab claim every response
  return Object.keys(values).length > 0 ? values : null;
}
