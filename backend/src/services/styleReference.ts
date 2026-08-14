import fs from "fs";
import path from "path";
import { listSourceFiles, expandHome } from "./fileReader";
import { isFileRoute } from "./frameworkRoutes";

// Generated code that does not look like the project it is going into is code
// nobody pastes. So before writing anything, one real file per layer is picked
// out of the project and handed to the model as the thing to imitate: its
// module style, its error handling, its naming, its quotes.

export type Layer = "router" | "controller" | "service";

export const LAYERS: Layer[] = ["router", "controller", "service"];

export interface StyleReference {
  layer: Layer;
  path: string;
  content: string;
  // shown to the user, because "we matched your style" is not believable
  // without naming the file the style was read from
  reason: string;
}

// a file long enough to show a pattern, short enough that three of them still
// leave the model room to answer
const MAX_REFERENCE_CHARS = 12_000;

// opening every file in a large project would cost as much as a scan, and this
// runs while someone waits on a chat reply. the ranking below means the files
// most likely to be the exemplars are the ones that get opened.
const MAX_EXAMINE = 250;

const DIR_HINTS: Record<Layer, RegExp> = {
  router: /(^|\/)(routes?|routers?|endpoints?)(\/|$)/i,
  controller: /(^|\/)(controllers?|handlers?)(\/|$)/i,
  service: /(^|\/)(services?|usecases?|repositories|repos|domain)(\/|$)/i,
};

// Weaker than the names above and scored lower, so a project with both a
// services/ and a lib/ still contributes services/. lib/ is where a Next.js
// project keeps the code an express project would call a service, and without
// it such a project has no service layer to imitate at all.
const WEAK_DIR_HINTS: Partial<Record<Layer, RegExp>> = {
  service: /(^|\/)(lib|helpers?|utils)(\/|$)/i,
};

const NAME_HINTS: Record<Layer, RegExp> = {
  router: /(^|[.\-_])(routes?|router)([.\-_]|$)/i,
  controller: /(^|[.\-_])(controllers?|handlers?)([.\-_]|$)/i,
  service: /(^|[.\-_])(services?|repository|repo|store)([.\-_]|$)/i,
};

// a spec file shows how the project tests, not how it writes endpoints
const SKIP_FILE = /(\.(test|spec)\.[jt]sx?$|\.d\.ts$|\.min\.js$)/i;

// A full stack repo has two services/ directories and only one of them is a
// backend. The frontend's is full of axios calls, and generating a router from
// it produces a router that calls its own api over http. Build output and
// migrations are excluded for the same reason: they are not written by hand.
const CLIENT_TREE =
  /(^|\/)(client|frontend|web|www|public|ui|mobile|dist|build|out|coverage|migrations|seeds?)(\/|$)/i;

function pathScore(layer: Layer, filePath: string): number {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath).replace(/\.[jt]sx?$/, "");

  // a next.js route file is the router: the framework reads its folder for the
  // path, so the file itself is where a request is registered and handled
  if (layer === "router" && isFileRoute(filePath)) return 4;

  const strong = (DIR_HINTS[layer].test(dir) ? 3 : 0) + (NAME_HINTS[layer].test(name) ? 3 : 0);
  if (strong > 0) return strong;

  return WEAK_DIR_HINTS[layer]?.test(dir) ? 2 : 0;
}

// what the file actually does, which outranks where it happens to live. plenty
// of projects keep handlers in routes/ and call them routes.
function contentScore(layer: Layer, content: string): number {
  const registersRoutes = /\b(router|app)\s*\.\s*(get|post|put|patch|delete)\s*\(/.test(content);
  const takesReqRes = /\(\s*req\s*(:\s*[^,)]+)?\s*,\s*res\b/.test(content);
  const writesResponse = /\bres\s*\.\s*(json|status|send|sendStatus)\s*\(/.test(content);

  if (layer === "router") {
    let score = 0;
    if (registersRoutes) score += 4;
    if (/\bexpress\s*\.\s*Router\s*\(/.test(content)) score += 3;
    // the file based equivalent: an exported verb is how the framework is told
    // which method this file answers
    if (/export\s+(async\s+)?(function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/.test(content)) {
      score += 4;
    }
    return score;
  }

  if (layer === "controller") {
    let score = 0;
    if (takesReqRes) score += 3;
    if (writesResponse) score += 3;
    // a file that wires up its own routes is the router, whatever it is called
    if (registersRoutes) score -= 4;
    return score;
  }

  // a service is the layer with no http in it at all. that absence is the
  // signal, so it is scored rather than assumed.
  let score = 0;
  if (/\bexport\s+(default\s+)?(async\s+)?(function|const|class)|\bmodule\.exports\s*=/.test(content)) {
    score += 2;
  }
  if (!writesResponse && !takesReqRes) score += 4;
  else score -= 4;
  return score;
}

// very short files carry no pattern worth copying, very long ones crowd out the
// other two layers
function sizeScore(length: number): number {
  if (length < 200) return -3;
  if (length > MAX_REFERENCE_CHARS) return -1;
  return 1;
}

function describe(layer: Layer, filePath: string, projectPath: string): string {
  const shown = path.relative(projectPath, filePath) || path.basename(filePath);
  return `${layer} style from ${shown}`;
}

export interface StylePick {
  references: StyleReference[];
  // how many source files were considered, so an empty result can say whether
  // it looked at nothing or looked and found nothing
  examined: number;
}

export function pickStyleReferences(rawPath: string): StylePick {
  // the walk expands ~ itself, and the paths it returns are absolute, so the
  // root has to be expanded here too or every relative path comes out wrong
  const projectPath = expandHome(rawPath);
  const all = listSourceFiles(projectPath)
    .filter((f) => !SKIP_FILE.test(f))
    .filter((f) => !CLIENT_TREE.test(path.dirname(f).slice(projectPath.length)));

  // ranked on the name alone first, which costs no i/o. the files that look
  // like exemplars get opened; the rest fill the budget only if there is room.
  const ranked = all
    .map((filePath) => ({
      filePath,
      hint: Math.max(...LAYERS.map((l) => pathScore(l, filePath))),
    }))
    .sort((a, b) => b.hint - a.hint)
    .slice(0, MAX_EXAMINE);

  const best = new Map<Layer, { filePath: string; content: string; score: number }>();

  for (const { filePath } of ranked) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    for (const layer of LAYERS) {
      const onPath = pathScore(layer, filePath);

      // A controller and a service are layers a project chooses to have, and
      // it says so by naming a directory. Recognising them from content alone
      // found middleware, a debug script and a frontend's api client, each of
      // which would have taught the model to write the wrong thing. A router
      // is the exception, because router.get() means only one thing wherever
      // it appears. Projects without the other two layers get a router
      // reference and an honest gap, rather than an invented exemplar.
      if (layer !== "router" && onPath === 0) continue;

      const score = onPath + contentScore(layer, content) + sizeScore(content.length);
      // below this the match is incidental: a file that merely lacks res.json
      // is not thereby a service layer
      if (score < 5) continue;

      const held = best.get(layer);
      if (!held || score > held.score) best.set(layer, { filePath, content, score });
    }
  }

  // one file cannot stand in for two layers. the layer that scored it higher
  // keeps it, so a project with routes and handlers in one file contributes one
  // reference rather than the same text twice.
  const claimed = new Set<string>();
  const references: StyleReference[] = [];

  for (const layer of LAYERS) {
    const pick = best.get(layer);
    if (!pick) continue;

    const takenBy = LAYERS.find(
      (other) => other !== layer && best.get(other)?.filePath === pick.filePath
    );
    if (takenBy && (best.get(takenBy)?.score ?? 0) > pick.score) continue;
    if (claimed.has(pick.filePath)) continue;
    claimed.add(pick.filePath);

    references.push({
      layer,
      path: pick.filePath,
      content:
        pick.content.length > MAX_REFERENCE_CHARS
          ? `${pick.content.slice(0, MAX_REFERENCE_CHARS)}\n// ...file truncated for length`
          : pick.content,
      reason: describe(layer, pick.filePath, projectPath),
    });
  }

  return { references, examined: ranked.length };
}
