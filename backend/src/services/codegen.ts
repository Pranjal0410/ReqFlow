import path from "path";
import { parseError } from "./applyCode";
import {
  StyleReference,
  SchemaReference,
  pickStyleReferences,
  pickSchemaReferences,
} from "./styleReference";
import { listSourceFiles } from "./fileReader";
import { getProvider, stripFences } from "./llm";
import { Instruction, formatInstructions } from "./instructions";
import { expandHome } from "./fileReader";

export interface GeneratedLayer {
  layer: string;
  // the file this belongs in. an existing path means "add this to that file",
  // which is why nothing is written automatically.
  path: string;
  code: string;
}

// How to prove the new endpoint works once its code is in the project: run it,
// then read the result back. Which GET does the reading is a question about the
// project's own routes, so it is asked of the model that just wrote them rather
// than guessed from the path. A POST to /api/users does not reliably imply a
// GET /api/users/:id, and a wrong guess spends a real request to learn nothing.
export interface VerifyPlan {
  // where in the create response the new record's id is, e.g. "data.id".
  // null when the endpoint returns nothing worth carrying into the read.
  idFrom: string | null;
  get: { method: string; path: string } | null;
}

export interface GeneratedEndpoint {
  method: string;
  path: string;
  summary: string;
  layers: GeneratedLayer[];
  // what a request against the new endpoint would look like, so the same tab
  // flow that works for a scanned route works for one that does not exist yet.
  // pathParams matters more than it looks: an endpoint whose own path carries
  // an :id cannot be called at all without one, and DELETE /users/:id is not an
  // unusual shape.
  request: {
    headers: Record<string, string>;
    pathParams: Record<string, string>;
    body: any | null;
  };
  notes: string[];
  references: { layer: string; path: string; reason: string }[];
  verify: VerifyPlan | null;
}

function buildPrompt(
  references: StyleReference[],
  schemas: SchemaReference[],
  description: string,
  projectPath: string,
  instructions: Instruction[]
): string {
  // project-relative, because an absolute path tells the model where this
  // machine keeps its home directory and nothing about the project's layout.
  // Given /Users/x/proj/routes/auth.js it answered src/routes/rooms.js for a
  // project with no src/ in it.
  const exemplars = references
    .map(
      (r) =>
        `--- ${r.layer.toUpperCase()} LAYER, real file from this project: ${shortenPath(
          r.path,
          projectPath
        )}\n${r.content}`
    )
    .join("\n\n");

  const layout = references
    .map((r) => `  ${r.layer}: ${path.dirname(shortenPath(r.path, projectPath))}/`)
    .join("\n");

  const layerNames = references.map((r) => r.layer).join(", ");

  // The shape of the data, which the exemplars do not carry.
  //
  // Given only a router and a service, a model writes plausible queries against
  // a schema it has imagined. Asked for GET /incidents/:id/notes it populated
  // `notes.author` on a project whose notes are separate documents — code that
  // parses, applies, boots, and answers 500 on a path that does not exist. The
  // schema is the one thing that makes those queries checkable in advance.
  const shapes = schemas.length
    ? schemas
        .map((s) => `--- DATA MODEL, real file from this project: ${s.path}\n${s.content}`)
        .join("\n\n")
    : "";

  // above the exemplars rather than below them: the last thing in a prompt this
  // long is the code, and a rule buried under three files reads as optional
  const standing = formatInstructions(instructions);

  return `You are adding one new endpoint to an existing Node.js project. Below are real files from that project, one per layer.

Copy their style exactly. Module system (import vs require), language (TypeScript vs JavaScript), quote style, semicolons, indentation, async style, naming convention, validation approach, error handling and response shape all come from these files, not from your own preferences. Do not introduce a library that does not already appear in them.

This project has these layers: ${layerNames}. Write the new endpoint across those layers and no others. If it only has a router, put everything in the router.

${shapes ? `Below are the project's data models. Query only the fields they actually declare, and follow the relationships they define — a field that is not in the schema does not exist, however natural its name sounds. If your code uses one of these models, require it at the top of your block; a model used without being required throws at runtime and the endpoint answers 500. Do not modify these files; they are here to be read.\n\n${shapes}\n\n` : ""}Return the NEW code to add, not a rewritten copy of the existing file. Each layer's code should be a self-contained block that a developer can paste into the named file: the handler, the service function, the route registration. Write every import your code needs as a real statement at the top of the block — never as a comment, and never assuming the file already has it. A commented-out require is not an import: the code parses, applies, boots, and the endpoint answers 500 because the name was never bound. ReqFlow removes any import the target file already has, so writing one that turns out to be a duplicate costs nothing and leaving one out costs the endpoint.

${standing ? `${standing}\n\n` : ""}The endpoint to add:
${description}

Return ONLY valid JSON, no markdown fences and no explanation, in exactly this shape:

{
  "method": "POST",
  "path": "/api/incidents/:id/comments",
  "summary": "one line, what the endpoint does",
  "layers": [
    {"layer": "router", "path": "src/routes/incidents.js", "code": "..."},
    {"layer": "controller", "path": "src/controllers/incidents.js", "code": "..."},
    {"layer": "service", "path": "src/services/incidents.js", "code": "..."}
  ],
  "request": {
    "headers": {"Content-Type": "application/json"},
    "pathParams": {"id": "1"},
    "body": {"text": "Looks like a cert expiry"}
  },
  "notes": ["anything the developer has to do by hand, e.g. a migration or a new env var"],
  "verify": {
    "idFrom": "data.id",
    "get": {"method": "GET", "path": "/api/incidents/:id/comments"}
  }
}

"verify" describes how to confirm the endpoint works once its code is in the project: it will be called, and then "verify".get will be called to read the result back. "idFrom" names the field of the create response holding the new record's identifier, written as a path under "data", the response body. Use null for it when the response carries nothing the read needs, and put the id into "verify".get.path as a ":id" style placeholder wherever it belongs. Only name routes that exist in this project or that you are writing now. If reading the result back is not possible, use null for the whole "verify" object rather than inventing a route.

"path" for each layer must be the file the code belongs in, written relative to the project root. This project keeps each layer here:

${layout}

Reuse the exact path of the example file when the new code belongs in it. When the endpoint needs a new file, put it in that layer's directory exactly as listed above and change only the filename. Do not add a src/ prefix, or any other directory, that is not in that list.

"request".pathParams gives a value for every ":name" in "path", so the endpoint can actually be called. Use an id that exists in this project already — read the seed data, fixtures or defaults in the files above and use one of those — rather than inventing a number. An empty object when the path has no parameters.

"request".body must be a realistic payload that would pass the validation you just wrote, not {"field": "string"}. Use null for GET and DELETE. "request".headers must include whatever the existing files require, including an Authorization header if the exemplars check for one; write it as "Bearer {{token}}" so it picks up the workspace variable.

Existing project files:

${exemplars}`;
}

// A model asked for "only the new code" will still hand back the file's imports
// and its export, because that is what a complete file looks like. Pasted in,
// `const router = express.Router()` a second time is not untidy, it is a
// SyntaxError, and the endpoint that was just added stops the whole file from
// loading.
//
// Only structural lines are dropped, and only when the file already has that
// exact line. A repeated `res.json(user)` is ordinary code and stays.
// What this is for: a model asked for "only the new code" still hands back the
// file's imports, and landing them on top of a file that already has them is a
// SyntaxError.
//
// It used to match any line beginning with const, at any indentation. Their
// router already had `const { userId } = req.body;` inside another handler, so
// the same line was cut out of the new one as a duplicate — leaving userId
// undefined and the endpoint answering 500. A local variable that happens to
// share a line with one somewhere else in the file is not a duplicate import.
//
// So: file-scope only, which is where imports live and where a real clash can
// happen. Indentation is the test, because a line inside a function body cannot
// collide with anything at the top of the file.
const STRUCTURAL =
  /^(const|let|var|import)\s|^(module\.exports|exports\.[A-Za-z_$])\s*=|^export\s+(default|\{)|^require\(/;

// A line that opens a body, and therefore heads the code that follows it.
//
// `const router = express.Router();` is complete in itself, and restating one
// the file already has is a duplicate declaration. `const getTimeline = async
// (id) => {` is the head of the very function being written — cutting it as a
// duplicate leaves a body with no head and a trailing brace closing nothing,
// which is what made every regeneration of an existing endpoint unparseable.
//
// Whether a line opens a body is the difference, and it is visible on the line.
const OPENS_A_BODY = /(\{|=>)\s*$/;

export function dropDuplicateLines(code: string, existing: string): string {
  // only the file's own top-level lines can be clashed with
  const already = new Set(
    existing
      .split("\n")
      .filter((l) => !/^\s/.test(l))
      .map((l) => l.trim())
      .filter(Boolean)
  );

  const kept = code
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      // indented means nested, and nested means local to a function
      if (/^\s/.test(line)) return true;
      // never decapitate the block's own code
      if (OPENS_A_BODY.test(trimmed)) return true;
      return !(already.has(trimmed) && STRUCTURAL.test(line));
    })
    .join("\n");

  // collapse the blank lines the removals left behind
  return kept.replace(/\n{3,}/g, "\n\n").trim();
}

// Told a project has no controller layer, the model still returns a controller
// entry holding a comment that says so. Read as a tab, that is an empty file
// where a developer expects code. Judged on whether anything survives having
// its comments removed, it is what it is: a remark, not a layer.
export function hasRealCode(code: string): boolean {
  return (
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .trim().length > 0
  );
}


// Where a generated layer should actually be written.
//
// In order: the file it named if that file exists; the real file with the same
// name somewhere else in the project, which is the misspelled-path case; a new
// file, if it was named inside a directory the project already keeps this kind
// of file in — a genuinely new resource is a new file, and forcing it into an
// existing one is worse than creating it. Only a path that matches nothing at
// all falls back to the layer's own file.
export function snapPath(
  claimed: string,
  layer: string,
  real: Set<string>,
  known: Map<string, string>
): string {
  if (real.has(claimed)) return claimed;
  if (!claimed) return known.get(layer) || `${layer}.js`;

  const base = (p: string) => p.split("/").pop() || p;
  const dir = (p: string) => p.slice(0, p.lastIndexOf("/"));

  const sameName = [...real].find((r) => base(r) === base(claimed));
  if (sameName) return sameName;

  // a new file is only allowed where this project already puts files of this
  // kind, so the model cannot invent a directory tree of its own
  const claimedDir = dir(claimed);
  const dirIsUsed = [...real].some((r) => dir(r) === claimedDir);
  if (claimedDir && dirIsUsed) return claimed;

  return known.get(layer) || claimed;
}

export function coerceLayers(
  raw: any,
  references: StyleReference[],
  root: string
): GeneratedLayer[] {
  if (!Array.isArray(raw)) return [];

  const known = new Map<string, string>(
    references.map((r) => [String(r.layer), shortenPath(r.path, root)])
  );
  const real = new Set(known.values());
  // the file each layer is going into, so a block that repeats its imports can
  // have them taken back out before they become a second declaration
  const contentByPath = new Map<string, string>(
    references.map((r) => [shortenPath(r.path, root), r.content])
  );

  return raw
    .filter((l) => l && typeof l.code === "string" && hasRealCode(l.code))
    .map((l) => {
      const layer = String(l.layer || "code");
      const claimed = String(l.path || "").trim();

      // Snapped to the project's real file for this layer whenever there is one.
      // src/routes/users.js against a project whose router is routes/users.js is
      // not a new file the developer wanted, it is the same file misspelled, and
      // writing it as claimed leaves the code somewhere nothing requires.
      //
      // But "one real file per layer" is only true of a project with one router.
      // A project with routes/auth.js, routes/incidents.js and routes/users.js
      // has three, and snapping every router layer onto whichever one this map
      // happened to keep put a products endpoint inside auth.js — new code in an
      // unrelated file, which at best does not answer and at worst breaks the
      // resource it landed in. So the claimed path is matched against the real
      // files first, and only an unrecognisable one falls back to the layer.
      const path = snapPath(claimed, layer, real, known);

      // Asked for "only the new code", a model still hands back the file's
      // imports, because that is what a complete file looks like. Landing on top
      // of the file that already has them, `const usersService = require(...)` a
      // second time is a SyntaxError and the whole file stops loading.
      const existing = contentByPath.get(path) ?? "";
      const code = dropDuplicateLines(String(l.code).trim(), existing);

      return { layer, path, code };
    })
    .filter((l) => hasRealCode(l.code));
}

// A half-built verify plan is worse than none: it would send a request against
// a route the model did not really commit to, and report the 404 as the new
// endpoint failing. Anything that is not a usable method and path collapses to
// null, and the flow then stops after the create call.
export function coerceVerify(raw: any): VerifyPlan | null {
  if (!raw || typeof raw !== "object") return null;

  const get = raw.get;
  if (!get || typeof get !== "object") return null;

  const method = String(get.method || "GET").toUpperCase();
  const path = String(get.path || "").trim();
  if (!path.startsWith("/")) return null;

  const idFrom =
    typeof raw.idFrom === "string" && raw.idFrom.trim() ? raw.idFrom.trim() : null;

  return { idFrom, get: { method, path } };
}

// The shape buildPrompt asks for, written as a schema so a provider that can
// constrain its sampler is held to it. Kept in step with the example in the
// prompt: the prompt is what a hosted model reads, and this is what a local one
// is allowed to emit, and they have to describe the same thing.
function endpointSchema(references: StyleReference[], root: string) {
  const paths = references.map((r) => shortenPath(r.path, root));
  const layerNames = references.map((r) => r.layer);

  return {
  type: "object",
  required: ["method", "path", "layers"],
  properties: {
    method: { type: "string" },
    path: { type: "string" },
    summary: { type: "string" },
    // minItems, because a schema that allows an empty array gets one. Asked for
    // layers with no floor, Qwen answered `"layers": []` every time — correct
    // against the schema, useless as an answer. The sampler enforces this, so
    // the model cannot take that road at all rather than being asked not to.
    layers: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          // Not free text. Told plainly not to, small models still answer
          // src/routes/users.js for a project whose file is routes/users.js —
          // and the code then lands in a file nothing requires, so the endpoint
          // 404s with its source sitting on disk. The project's own files are
          // known, so the model picks from them instead of naming one.
          layer: { enum: layerNames },
          path: { enum: paths },
          code: { type: "string" },
        },
        required: ["layer", "path", "code"],
      },
    },
    request: {
      type: "object",
      properties: {
        headers: { type: "object" },
        pathParams: { type: "object" },
        body: { oneOf: [{ type: "null" }, { type: "object" }] },
      },
    },
    notes: { type: "array", items: { type: "string" } },
    verify: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            idFrom: { oneOf: [{ type: "null" }, { type: "string" }] },
            get: {
              type: "object",
              properties: { method: { type: "string" }, path: { type: "string" } },
            },
          },
        },
      ],
    },
  },
  } as const;
}

// The route the generated code registers, read from the code itself.
//
// Only a router layer registers anything, and only its own registration counts —
// a service that happens to mention router.get in a comment is not registering
// a route. The path is joined to what the router is mounted at, which the model
// states and the code cannot know.
const REGISTRATION =
  /^\s*(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]*)['"`]/m;

export function registeredRoute(
  layers: { layer: string; code: string }[]
): { method: string; path: string } | null {
  const router = layers.find((l) => l.layer === "router");
  if (!router) return null;

  const match = REGISTRATION.exec(router.code);
  if (!match) return null;

  return { method: match[1].toUpperCase(), path: match[2] };
}

// Keep the mount the model named, take the tail the code registered.
// /api/incidents + /:id/commander, even if the model wrote /:id/lead beside it.
export function alignPath(full: string, registered: string | undefined): string {
  if (!registered || !full) return full;

  const tail = registered === "/" ? "" : registered;
  if (!tail || full.endsWith(tail)) return full;

  // the mount is whatever the model's path had before its own last segments;
  // matching on segment count keeps this from cutting a path it misread
  const fullParts = full.split("/").filter(Boolean);
  const tailParts = tail.split("/").filter(Boolean);
  if (tailParts.length === 0 || tailParts.length >= fullParts.length) return full;

  const mount = fullParts.slice(0, fullParts.length - tailParts.length);
  return `/${[...mount, ...tailParts].join("/")}`;
}

// The block as the file will hold it: inside a function, where await and return
// are allowed. Only the shape changes; a real syntax error still fails.
export function asFragment(code: string): string {
  return `async function __reqflow_check() {\n${code}\n}`;
}

// Thrown when the model's own output will not parse. Named so the caller can
// tell it apart from a project problem and simply ask again — the developer did
// nothing wrong and there is nothing for them to fix.
export class UnusableCode extends Error {
  constructor(detail: string) {
    super(`the model returned code that does not parse (${detail})`);
    this.name = "UnusableCode";
  }
}

// The resource an ask is about, taken from the first path-looking thing in it.
// Only used to rank which schema matters most, so a miss costs ordering and
// nothing else.
function pathOf(description: string): string {
  const match = /\/[a-zA-Z0-9/:_-]+/.exec(description);
  return match ? match[0] : "";
}

export async function generateEndpoint(
  projectPath: string,
  description: string,
  instructions: Instruction[] = []
): Promise<GeneratedEndpoint> {
  // the endpoint's own resource decides which router and service it is written
  // against, so an incidents endpoint is shown the incidents files
  const target = pathOf(description);
  const { references, examined } = pickStyleReferences(projectPath, target);

  if (references.length === 0) {
    throw new Error(
      examined === 0
        ? "no source files found in that folder, so there is no style to follow"
        : "no router, controller or service files could be identified in that project"
    );
  }

  const root = expandHome(projectPath);
  const provider = getProvider("codegen");
  // read from the project, never written to: the endpoint is written against
  // the schema the project actually has
  const schemas = pickSchemaReferences(projectPath, listSourceFiles(root), target);
  const prompt = buildPrompt(references, schemas, description, root, instructions);

  // One call, whatever the model. Every layer is written having seen the others,
  // which is the only way the router can call a function the service actually
  // exports — and it prefills the project's files once rather than once per
  // layer, which is where most of the waiting used to go.
  let parsed: any;
  if (provider.generateJson) {
    parsed = await provider.generateJson(prompt, endpointSchema(references, root) as any);
  } else {
    const cleaned = stripFences(await provider.generateText(prompt));
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("the model did not return usable code. Try describing the endpoint again.");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("the model did not return usable code. Try describing the endpoint again.");
  }

  const layers = coerceLayers(parsed.layers, references, root);
  if (layers.length === 0) {
    throw new Error("the model returned no code for this endpoint. Try describing it again.");
  }

  // Code that does not parse is not a diff worth reading.
  //
  // The write refuses it — correctly, nothing broken reaches the project — but
  // that refusal arrives at the end of a review the developer has already done,
  // and it reads as the app failing rather than as the model having produced a
  // stray bracket. It happens rarely and it does not happen twice in a row, so
  // it is caught here and asked for again.
  // Checked as a fragment, which is what it is.
  //
  // Parsed as a whole script, a perfectly good service block fails on "await is
  // only valid in async functions" — the block is going to sit inside the
  // project's own file, where that await is legal, and refusing it there made
  // generation fail about half the time. Wrapping it the way the file will means
  // this catches what it was meant to catch — an unbalanced bracket, a stray
  // token — and nothing else. The authoritative check still runs at apply time,
  // against the real merged file.
  const broken = layers.find((l) => parseError(l.path, asFragment(l.code)));
  if (broken) {
    throw new UnusableCode(
      `${broken.layer} code: ${parseError(broken.path, asFragment(broken.code))}`
    );
  }

  // What the code actually registers, not what the model said alongside it.
  //
  // A model wrote router.patch('/:id/commander', ...) and reported
  // "method": "POST" in the same answer. ReqFlow verified with POST, got a 404,
  // and said the server was running code from before the write — while the route
  // sat in the file, correct, under a different verb. The registration is the
  // fact; the field beside it is a description of the fact, and where they
  // disagree the file wins. This is the same rule already applied to paths.
  const registered = registeredRoute(layers);
  const method = registered?.method ?? String(parsed.method || "GET").toUpperCase();

  // The router's own path is relative to wherever it is mounted, so the full
  // path still comes from the model — but its tail has to be the one the code
  // registered, or the request goes somewhere the code never claimed.
  const claimedPath = String(parsed.path || "");
  const endpointPath = alignPath(claimedPath, registered?.path);

  return {
    method,
    path: endpointPath,
    summary: String(parsed.summary || ""),
    layers,
    request: {
      headers:
        parsed.request?.headers && typeof parsed.request.headers === "object"
          ? parsed.request.headers
          : {},
      pathParams:
        parsed.request?.pathParams && typeof parsed.request.pathParams === "object"
          ? Object.fromEntries(
              Object.entries(parsed.request.pathParams).map(([k, v]) => [k, String(v)])
            )
          : {},
      body: parsed.request?.body ?? null,
    },
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    verify: coerceVerify(parsed.verify),
    references: references.map((r) => ({
      layer: r.layer,
      path: shortenPath(r.path, root),
      reason: r.reason,
    })),
  };
}

// the file list is shown in the code view, where an absolute path eats the
// width without telling anyone anything they did not already know
export function shortenPath(filePath: string, projectPath: string): string {
  const rel = path.relative(projectPath, filePath);
  return rel && !rel.startsWith("..") ? rel : filePath;
}
