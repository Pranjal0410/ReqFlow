import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { StyleReference, pickStyleReferences } from "./styleReference";
import { expandHome } from "./fileReader";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// same reasoning as the scan: the lite model's free tier allowance is what
// makes repeated use of this practical
const CODEGEN_MODEL = process.env.GEMINI_CODEGEN_MODEL || "gemini-3.1-flash-lite";

export interface GeneratedLayer {
  layer: string;
  // the file this belongs in. an existing path means "add this to that file",
  // which is why nothing is written automatically.
  path: string;
  code: string;
}

export interface GeneratedEndpoint {
  method: string;
  path: string;
  summary: string;
  layers: GeneratedLayer[];
  // what a request against the new endpoint would look like, so the same tab
  // flow that works for a scanned route works for one that does not exist yet
  request: { headers: Record<string, string>; body: any | null };
  notes: string[];
  references: { layer: string; path: string; reason: string }[];
}

function buildPrompt(
  references: StyleReference[],
  description: string,
  projectPath: string
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

  return `You are adding one new endpoint to an existing Node.js project. Below are real files from that project, one per layer.

Copy their style exactly. Module system (import vs require), language (TypeScript vs JavaScript), quote style, semicolons, indentation, async style, naming convention, validation approach, error handling and response shape all come from these files, not from your own preferences. Do not introduce a library that does not already appear in them.

This project has these layers: ${layerNames}. Write the new endpoint across those layers and no others. If it only has a router, put everything in the router.

Return the NEW code to add, not a rewritten copy of the existing file. Each layer's code should be a self-contained block that a developer can paste into the named file: the handler, the service function, the route registration. Include the imports the new code needs at the top of the block, as a comment if they belong elsewhere in the file.

The endpoint to add:
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
    "body": {"text": "Looks like a cert expiry"}
  },
  "notes": ["anything the developer has to do by hand, e.g. a migration or a new env var"]
}

"path" for each layer must be the file the code belongs in, written relative to the project root. This project keeps each layer here:

${layout}

Reuse the exact path of the example file when the new code belongs in it. When the endpoint needs a new file, put it in that layer's directory exactly as listed above and change only the filename. Do not add a src/ prefix, or any other directory, that is not in that list.

"request".body must be a realistic payload that would pass the validation you just wrote, not {"field": "string"}. Use null for GET and DELETE. "request".headers must include whatever the existing files require, including an Authorization header if the exemplars check for one; write it as "Bearer {{token}}" so it picks up the workspace variable.

Existing project files:

${exemplars}`;
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

function coerceLayers(raw: any, references: StyleReference[]): GeneratedLayer[] {
  if (!Array.isArray(raw)) return [];

  const known = new Map<string, string>(references.map((r) => [String(r.layer), r.path]));

  return raw
    .filter((l) => l && typeof l.code === "string" && hasRealCode(l.code))
    .map((l) => {
      const layer = String(l.layer || "code");
      return {
        layer,
        // a model that answers with a bare filename leaves the developer
        // guessing which of three directories it meant
        path: String(l.path || known.get(layer) || `${layer}.js`),
        code: String(l.code).trim(),
      };
    });
}

export async function generateEndpoint(
  projectPath: string,
  description: string
): Promise<GeneratedEndpoint> {
  const { references, examined } = pickStyleReferences(projectPath);

  if (references.length === 0) {
    throw new Error(
      examined === 0
        ? "no source files found in that folder, so there is no style to follow"
        : "no router, controller or service files could be identified in that project"
    );
  }

  const root = expandHome(projectPath);
  const model = genAI.getGenerativeModel({ model: CODEGEN_MODEL });
  const result = await model.generateContent(buildPrompt(references, description, root));
  const text = result.response.text().trim();
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("the model did not return usable code. Try describing the endpoint again.");
  }

  const layers = coerceLayers(parsed.layers, references);
  if (layers.length === 0) {
    throw new Error("the model returned no code for this endpoint. Try describing it again.");
  }

  const method = String(parsed.method || "GET").toUpperCase();

  return {
    method,
    path: String(parsed.path || ""),
    summary: String(parsed.summary || ""),
    layers,
    request: {
      headers:
        parsed.request?.headers && typeof parsed.request.headers === "object"
          ? parsed.request.headers
          : {},
      body: parsed.request?.body ?? null,
    },
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
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
