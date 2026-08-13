// A scanned route arrives as /api/incidents/:id, and clicking it used to hand
// you that url verbatim. The placeholder stays in the tab so the row can be
// edited again, and the value is substituted on the way out, the same way
// {{variables}} are.

export const PATH_PARAM = /:([A-Za-z0-9_]+)/g;

export function namesIn(url: string): string[] {
  const out: string[] = [];
  for (const m of url.matchAll(PATH_PARAM)) {
    // a port is not a path parameter: :3001 never starts with a letter
    if (/^[A-Za-z_]/.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function applyPathParams(url: string, values: Record<string, string>): string {
  return url.replace(PATH_PARAM, (whole, name) => {
    if (!/^[A-Za-z_]/.test(name)) return whole;
    const value = values[name];
    // an unfilled one is left as written, so the request fails somewhere
    // obvious instead of silently hitting /api/incidents//notes
    return value ? encodeURIComponent(value) : whole;
  });
}

// which of a url's placeholders still have nothing behind them
export function unfilled(url: string, values: Record<string, string>): string[] {
  return namesIn(url).filter((n) => !values[n]);
}
