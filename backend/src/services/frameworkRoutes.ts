// Express writes its routes down: router.get("/users") says both things in one
// line. Next.js writes neither. The path is the folder the file sits in and the
// method is the name of an exported function, so a model reading the file alone
// has nothing to extract, which is why a Next.js project used to scan to zero
// endpoints.
//
// None of that needs a model. The path is derivable from the filename by rules
// the framework publishes, so it is derived here and handed to the scan as
// fact, leaving the model to do the part it is actually good at: reading the
// code for what the endpoint expects.

export interface FileRoute {
  method: string;
  path: string;
  file: string;
}

// app/api/users/route.ts, and the same under src/. tsx is legal and people use
// it by accident, so it is accepted rather than silently skipped.
const APP_ROUTE = /(?:^|\/)app\/(.*\/)?route\.[jt]sx?$/;
// pages/api/users.ts, the router Next.js had before the app directory
const PAGES_ROUTE = /(?:^|\/)pages\/api\/(.+)\.[jt]sx?$/;

export function isFileRoute(filePath: string): boolean {
  return APP_ROUTE.test(filePath) || PAGES_ROUTE.test(filePath);
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// A segment can be a route group (admin), a parallel route @modal or a private
// folder _components. None of the three appear in the url, and treating them as
// path segments is how you get /api/(admin)/users, which 404s.
function isInvisible(segment: string): boolean {
  return (
    (segment.startsWith("(") && segment.endsWith(")")) ||
    segment.startsWith("@") ||
    segment.startsWith("_")
  );
}

// [id] -> :id, [...slug] -> :slug, [[...slug]] -> :slug. the last two match
// more than one segment, which a path parameter cannot express, so they are
// written as one and the developer fills in whatever they need.
function toParam(segment: string): string {
  const inner = segment.replace(/^\[+|\]+$/g, "").replace(/^\.\.\./, "");
  return segment.startsWith("[") ? `:${inner}` : segment;
}

function urlFromSegments(segments: string[]): string {
  const visible = segments.filter((s) => s && !isInvisible(s)).map(toParam);
  return `/${visible.join("/")}`.replace(/\/+$/, "") || "/";
}

// export async function GET(...), export function GET(...), export const GET =
function exportedMethods(content: string): string[] {
  return HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${m}\\b|const\\s+${m}\\s*[:=])`).test(content)
  );
}

// A pages/api handler is one default export that branches on req.method, so the
// methods have to be read out of the branching. Finding none does not mean the
// file handles nothing, it means it handles everything, and GET is the one
// someone opening it in a browser will send.
function branchedMethods(content: string): string[] {
  const found = HTTP_METHODS.filter((m) =>
    new RegExp(`req\\.method\\s*===?\\s*["'\`]${m}["'\`]|case\\s*["'\`]${m}["'\`]`, "i").test(content)
  );
  return found.length ? found : ["GET"];
}

function appRoute(filePath: string, content: string): FileRoute[] {
  const match = filePath.match(APP_ROUTE);
  if (!match) return [];

  const path = urlFromSegments((match[1] || "").split("/"));
  return exportedMethods(content).map((method) => ({ method, path, file: filePath }));
}

function pagesRoute(filePath: string, content: string): FileRoute[] {
  const match = filePath.match(PAGES_ROUTE);
  if (!match) return [];

  // index is the folder itself, not a segment called index
  const segments = match[1].split("/").filter((s) => s !== "index");
  const path = urlFromSegments(["api", ...segments]);
  return branchedMethods(content).map((method) => ({ method, path, file: filePath }));
}

export function deriveFileRoutes(files: { path: string; content: string }[]): FileRoute[] {
  const out: FileRoute[] = [];
  for (const file of files) {
    out.push(...appRoute(file.path, file.content), ...pagesRoute(file.path, file.content));
  }
  return out;
}
