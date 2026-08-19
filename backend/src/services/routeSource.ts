import fs from "fs";
import path from "path";
import { listSourceFiles, expandHome } from "./fileReader";

// The code behind an endpoint the project already has.
//
// A generated endpoint arrives with its source attached, so showing it is free.
// A scanned one does not: the scan reports a method and a path, and the code
// that serves it is somewhere in the project. This finds it.
//
// Nothing here parses JavaScript. It looks for the registration the way a reader
// would — the line that names this method and this path — and then takes the
// block that follows it. A parser would be more correct and would also refuse
// half the files it met; this is a viewer, and being unable to show something is
// a smaller failure than refusing to open at all.

export interface RouteSource {
  file: string;
  line: number;
  code: string;
}

const REGISTRATION =
  /^\s*(?:router|app)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]*)['"`]/;

// A file route: app/users/[id]/route.ts exporting GET. The path is the folder,
// which the scan already worked out, so here only the export matters.
const FILE_ROUTE_EXPORT =
  /^\s*export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/;

// Is the registered path the tail of the one the sidebar shows?
//
// A router mounted at /api/users registers /:id/role for what the scan calls
// /api/users/:id/role. Comparing them whole would find nothing; comparing only
// the last segment would match /:id/role against /api/incidents/:id/role too.
export function tailMatches(fullPath: string, registered: string): boolean {
  const full = fullPath.split("/").filter(Boolean);
  const tail = registered.split("/").filter(Boolean);

  if (tail.length > full.length) return false;

  const start = full.length - tail.length;
  for (let i = 0; i < tail.length; i++) {
    const a = full[start + i];
    const b = tail[i];
    // a parameter matches a parameter, whatever either is called
    if (a.startsWith(":") && b.startsWith(":")) continue;
    if (a !== b) return false;
  }
  return true;
}

// The block a registration opens, ending where its braces balance.
export function blockAt(lines: string[], start: number): string {
  let depth = 0;
  let seen = false;

  for (let j = start; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") depth--;
    }
    if (seen && depth === 0) {
      // the doc comment above it is part of what a reader wants
      let top = start;
      while (top > 0 && (lines[top - 1].startsWith(" *") || lines[top - 1].startsWith("/**"))) {
        top--;
      }
      return lines.slice(top, j + 1).join("\n");
    }
  }

  // no closing brace found — show a window rather than the rest of the file
  return lines.slice(start, Math.min(start + 40, lines.length)).join("\n");
}

export function findRouteSource(
  rawProjectPath: string,
  method: string,
  routePath: string
): RouteSource | null {
  const root = expandHome(rawProjectPath);
  const wanted = method.toUpperCase();

  // the resource this endpoint is about, used only to break a tie between two
  // files that both register a matching tail
  const resource = routePath
    .split("/")
    .filter((seg) => seg && !seg.startsWith(":") && seg.toLowerCase() !== "api")[0];

  const found: { source: RouteSource; likely: boolean }[] = [];

  for (const filePath of listSourceFiles(root)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const name = path.basename(filePath).toLowerCase();
    const likely = !!resource && name.includes(resource.replace(/s$/, "").toLowerCase());

    for (let i = 0; i < lines.length; i++) {
      const registration = REGISTRATION.exec(lines[i]);
      if (registration) {
        const [, verb, registered] = registration;
        if (verb.toUpperCase() !== wanted && verb !== "all") continue;
        if (!tailMatches(routePath, registered)) continue;

        // router.get('/') serves whatever the router is mounted at, and says
        // nothing about which resource that is — so it matched every path.
        // The file's own name is the only evidence available for a bare root,
        // and without it this is a guess rather than a lookup.
        const bareRoot = registered.split("/").filter(Boolean).length === 0;
        if (bareRoot && !likely) continue;
        found.push({
          source: {
            file: path.relative(root, filePath),
            line: i + 1,
            code: blockAt(lines, i),
          },
          likely,
        });
        continue;
      }

      // a file-based route: the path came from the folder, so the export is
      // enough to identify it once the scan has pointed at this file
      const exported = FILE_ROUTE_EXPORT.exec(lines[i]);
      if (exported && exported[1] === wanted && likely) {
        found.push({
          source: {
            file: path.relative(root, filePath),
            line: i + 1,
            code: blockAt(lines, i),
          },
          likely: true,
        });
      }
    }
  }

  if (found.length === 0) return null;
  return (found.find((f) => f.likely) ?? found[0]).source;
}
