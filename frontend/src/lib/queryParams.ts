// query parameters, edited as rows but stored in the url. keeping the url as
// the single source means typing "?page=2" by hand and using the editor can
// never disagree about what will be sent.

export interface QueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;

  const qAt = withoutHash.indexOf("?");
  return {
    base: qAt >= 0 ? withoutHash.slice(0, qAt) : withoutHash,
    query: qAt >= 0 ? withoutHash.slice(qAt + 1) : "",
    hash,
  };
}

export function paramsFromUrl(url: string): QueryParam[] {
  const { query } = splitUrl(url);
  if (!query) return [];

  return query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
      const rawValue = eq >= 0 ? pair.slice(eq + 1) : "";
      return {
        // a half typed {{var}} or % can fail to decode, and losing the row is
        // worse than showing it exactly as written
        key: safeDecode(rawKey),
        value: safeDecode(rawValue),
        enabled: true,
      };
    });
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

// {{name}} has to survive encoding, otherwise the braces come out as %7B%7B
// and the placeholder never resolves
function encodePreservingVars(text: string): string {
  return text
    .split(/(\{\{\s*[A-Za-z0-9_.-]+\s*\}\})/g)
    .map((part) => (part.startsWith("{{") ? part : encodeURIComponent(part)))
    .join("");
}

export function urlWithParams(url: string, params: QueryParam[]): string {
  const { base, hash } = splitUrl(url);

  const query = params
    .filter((p) => p.enabled && p.key.trim())
    .map((p) => `${encodePreservingVars(p.key)}=${encodePreservingVars(p.value)}`)
    .join("&");

  return `${base}${query ? `?${query}` : ""}${hash}`;
}
