import { ServerTimingSpan } from "../types";

// Server-Timing is how a server reports what it spent time on inside a request
// (https://www.w3.org/TR/server-timing/). The shape is
//
//   Server-Timing: db;dur=18;desc="INSERT INTO users", controller;dur=15
//
// which is the only honest source we have for the spans between receiving the
// request and sending the response. ReqFlow sits outside the target server and
// cannot see any of that itself.

// commas separate metrics and semicolons separate params, but both are legal
// inside a quoted desc, so splitting on the raw character would cut a
// description in half
function splitOutsideQuotes(input: string, separator: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoted) {
      if (ch === "\\" && i + 1 < input.length) {
        current += ch + input[++i];
        continue;
      }
      if (ch === '"') quoted = false;
      current += ch;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      current += ch;
      continue;
    }
    if (ch === separator) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  out.push(current);
  return out;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return trimmed;
}

export function parseServerTiming(
  header: string | string[] | undefined | null
): ServerTimingSpan[] {
  if (!header) return [];

  // the field may appear more than once, and the spec says repeats mean the
  // same thing as one comma joined list
  const raw = Array.isArray(header) ? header.join(",") : String(header);

  const spans: ServerTimingSpan[] = [];

  for (const metric of splitOutsideQuotes(raw, ",")) {
    const parts = splitOutsideQuotes(metric, ";");
    const name = parts[0].trim();
    if (!name) continue;

    let duration: number | null = null;
    let description: string | null = null;

    for (const param of parts.slice(1)) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;

      const key = param.slice(0, eq).trim().toLowerCase();
      const value = unquote(param.slice(eq + 1));

      if (key === "dur") {
        // dur=abc, a negative number, or an empty value tells us nothing, so
        // treat it as the server having sent no duration rather than showing a
        // made up one. the empty case needs its own check because Number("")
        // is 0, which would read on screen as a span that took no time.
        const ms = value === "" ? NaN : Number(value);
        if (Number.isFinite(ms) && ms >= 0) duration = ms;
      } else if (key === "desc") {
        description = value || null;
      }
    }

    spans.push({ name, description, duration });
  }

  return spans;
}
