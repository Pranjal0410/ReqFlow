// "localhost:3001" is what people type, and it is not a url. new URL() does not
// reject it either: it reads localhost: as the scheme, which makes origin the
// string "null" and makes the target guard call localhost a public address.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function withScheme(url: string): string {
  const text = url.trim();
  if (!text || HAS_SCHEME.test(text)) return text;
  // a bare host, a host:port or a path off one. http is the only sensible
  // guess for something a developer is running locally.
  return `http://${text.replace(/^\/+/, "")}`;
}

// the path, for anything that needs to show a url short. "localhost:3001/x"
// would otherwise come back as "3001/x", since URL reads localhost: as the
// scheme and the rest as the path.
export function pathOf(url: string): string {
  try {
    return new URL(withScheme(url)).pathname;
  } catch {
    return url;
  }
}

// the origin, but only for a url that really is http. anything else is treated
// as unparseable rather than yielding the "null" origin URL hands back for an
// unrecognised scheme.
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(withScheme(url));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
