// ReqFlow's proxy will fetch whatever url it is handed. The backend binds on
// 0.0.0.0 with cors wide open, so without this anyone on the same network can
// use the machine as an http relay and reach internal addresses that are not
// exposed to them. Only loopback and private ranges are allowed through.

const PRIVATE_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1", "[::1]"]);

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    // reject "01", "1e2", "" and anything non numeric so that a hostname like
    // 192.168.evil.com can never be mistaken for an address
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

// "localhost:3001" is how people write an address, and URL reads localhost: as
// the scheme, so the guard used to call it a public host and say so. giving it
// http:// first changes nothing about what is allowed, since the decision is
// still made on the hostname, but it lets the ordinary spelling through.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function withScheme(rawUrl: string): string {
  const text = rawUrl.trim();
  if (!text || HAS_SCHEME.test(text)) return text;
  return `http://${text.replace(/^\/+/, "")}`;
}

export function isPrivateTarget(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(withScheme(rawUrl));
  } catch {
    return false;
  }

  // anything that is not plain http stays refused, so a scheme we do not
  // understand cannot slip past the hostname checks below
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  if (PRIVATE_HOSTNAMES.has(host)) return true;
  // .local and .localhost are resolved on the local network only
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ip = parseIPv4(host);
  if (!ip) return false;

  const [a, b] = ip;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 169 && b === 254) return true; // link local
  if (a === 0) return true;

  return false;
}

export const TARGET_BLOCKED_MESSAGE =
  "only local and private network targets are allowed";
