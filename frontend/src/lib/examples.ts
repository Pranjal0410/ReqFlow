import { ApiResponse, RequestTab } from "../types";

// Every send is kept as an example of that endpoint: what went out and what came
// back, together. Nobody presses "save" — a button you have to remember only
// ever catches the runs you thought were worth keeping, which is never the one
// you want to look at later.
//
// This is a deliberate change to a rule the app used to hold: responses were not
// persisted at all, on the grounds that a stored response sitting next to a
// request that has not been sent this session reads as the current answer. That
// reasoning still stands, so an example is never restored into the response
// viewer as though it had just happened. It is dated, it lives in its own panel,
// and it says when it was captured.

export interface Example {
  id: string;
  at: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  response: ApiResponse;
}

export type ExampleStore = Record<string, Example[]>;

// Three or five, and no other numbers, because this is a "how much history do
// you want" question rather than a dial. Hareesh's read was that three is
// usually enough and five is for people who want the extra two.
export type ExampleLimit = 3 | 5;
export const DEFAULT_EXAMPLE_LIMIT: ExampleLimit = 3;

export function coerceLimit(raw: any): ExampleLimit {
  return raw === 5 ? 5 : DEFAULT_EXAMPLE_LIMIT;
}

// Same shape of key as the timing samples use: an endpoint is a method and a
// path, and the query string is not part of its identity.
export function exampleKey(method: string, url: string): string {
  const withoutQuery = url.split(/[?#]/)[0].replace(/\/+$/, "");
  return `${method.toUpperCase()} ${withoutQuery || url}`;
}

// A credential in a saved example is a credential on disk. The workspace already
// keeps secrets out of storage by name, and examples get the same treatment
// rather than a weaker version of it: the header is kept, so the request still
// reads as an authorised one, but its value is replaced.
const SECRET_HEADER = /^(authorization|cookie|proxy-authorization)$/i;
const SECRET_HINT = /(token|secret|password|passwd|api[-_]?key|credential)/i;

export function isSecretName(name: string): boolean {
  const trimmed = name.trim();
  return SECRET_HEADER.test(trimmed) || SECRET_HINT.test(trimmed);
}

export const REDACTED = "[removed before saving]";

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSecretName(k) ? REDACTED : v;
  }
  return out;
}

// A login body carries the password that a redacted Authorization header was
// meant to keep off disk, so the same rule runs over the body. Only the values
// go: the field names are the shape of the request, which is the part worth
// keeping.
export function redactBody(body: string): string {
  if (!body.trim()) return body;

  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    // not json, so there are no field names to judge. a body we cannot read is
    // not a body we can safely redact field by field.
    return SECRET_HINT.test(body) ? REDACTED : body;
  }

  const walk = (value: any): any => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = isSecretName(k) ? REDACTED : walk(v);
      }
      return out;
    }
    return value;
  };

  return JSON.stringify(walk(parsed), null, 2);
}

// The response is kept as it came back. It is the half the developer is looking
// for later, and a redacted one would be a different response.
export function toExample(
  tab: Pick<RequestTab, "method" | "url" | "body">,
  headers: Record<string, string>,
  response: ApiResponse,
  now: number
): Example {
  return {
    id: `${now}${Math.random().toString(36).slice(2)}`,
    at: now,
    method: tab.method,
    url: tab.url,
    headers: redactHeaders(headers),
    body: redactBody(tab.body || ""),
    response,
  };
}

// Newest first, capped at the limit. Lowering the limit takes effect on the next
// send rather than deleting history the user already has, which is why the trim
// happens here and not when the setting changes.
export function record(
  store: ExampleStore,
  example: Example,
  limit: ExampleLimit
): ExampleStore {
  const key = exampleKey(example.method, example.url);
  const existing = store[key] || [];
  return { ...store, [key]: [example, ...existing].slice(0, limit) };
}

export function forEndpoint(
  store: ExampleStore,
  method: string,
  url: string
): Example[] {
  return store[exampleKey(method, url)] || [];
}

// "2 minutes ago" rather than a timestamp: the only question being asked of an
// example is how stale it is.
export function describeAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}
