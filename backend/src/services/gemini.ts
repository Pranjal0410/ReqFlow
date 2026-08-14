import { GoogleGenerativeAI } from "@google/generative-ai";
import { DetectedRoute } from "../types";
import { deriveFileRoutes } from "./frameworkRoutes";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// gemini-3.5-flash caps at 20 requests a day on the free tier, which a few
// scans will burn through. the lite model has its own, much larger allowance.
const ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL || "gemini-3.1-flash-lite";

// Framework routes are facts, not guesses: Next.js puts the path in the folder
// name and the method in an exported function name, both of which are read
// exactly rather than inferred. Handing them over stops the model doing the one
// thing it cannot do here, which is invent a path out of a file that never
// states one.
function fileRouteBlock(files: { path: string; content: string }[]): string {
  const derived = deriveFileRoutes(files);
  if (derived.length === 0) return "";

  const listed = derived.map((r) => `${r.method} ${r.path}   (from ${r.file})`).join("\n");

  return `

some of these files use file based routing, where the url comes from the folder the file sits in rather than from anything written inside it. those routes have already been worked out for you and are correct:

${listed}

use those method and path pairs exactly as given for those files. do not rewrite, shorten or guess a different path for them, and do not skip one because the code does not mention it. read each file only for its description, params and body. every other file in this code is ordinary express, so extract its routes as usual.`;
}

export async function analyzeCode(files: { path: string; content: string }[]): Promise<DetectedRoute[]> {
  const model = genAI.getGenerativeModel({ model: ANALYZE_MODEL });

  const codeBlock = files
    .map((f) => `// FILE: ${f.path}\n${f.content}`)
    .join("\n\n---\n\n");

  const prompt = `analyze this Node.js API code. extract every API route you find.

for each route return:
- method (GET, POST, PUT, DELETE)
- path (like /users or /users/:id)
- description (one line about what it does)
- params (array of path or query params)
- body (example JSON payload if its POST/PUT, null otherwise)

the body is going to be sent as-is by someone testing the endpoint, so fill it
with values that would actually pass. read the validators, schemas, enums and
defaults in the code and use them: if severity must be one of low, medium or
high, pick one of those, not the word "string". write a plausible title rather
than "string", a well formed email rather than "string", a number where a
number is expected. only fall back to a placeholder for a value the code gives
you no way to guess, such as an id of another record.

return ONLY a valid JSON array. no markdown, no backticks, no explanation.

example format:
[{"method":"POST","path":"/users","description":"creates a new user","params":[],"body":{"name":"Ada Lovelace","email":"ada@example.com","age":36}}]
${fileRouteBlock(files)}

code:
${codeBlock}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // clean up in case gemini wraps it in backticks
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: DetectedRoute[];
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("gemini returned bad json:", cleaned);
    parsed = [];
  }

  return mergeFileRoutes(Array.isArray(parsed) ? parsed : [], deriveFileRoutes(files));
}

// The prompt asks the model not to drop a derived route, and mostly it does not.
// Mostly is not good enough for a route we already know exists: a missing
// endpoint reads as an endpoint the project does not have. Anything the model
// returned wins, since it read the code and can describe the endpoint; anything
// it left out is added back with what can be stated without reading anything.
export function mergeFileRoutes(
  parsed: DetectedRoute[],
  derived: { method: string; path: string; file: string }[]
): DetectedRoute[] {
  const seen = new Set(
    parsed.map((r) => `${String(r.method).toUpperCase()} ${r.path}`)
  );

  const missing = derived
    .filter((d) => !seen.has(`${d.method} ${d.path}`))
    .map((d) => ({
      method: d.method,
      path: d.path,
      description: `${d.method.toLowerCase()} handler in ${d.file.split("/").slice(-3).join("/")}`,
      params: d.path.match(/:(\w+)/g)?.map((p) => p.slice(1)) || [],
      body: null,
    }));

  return [...parsed, ...missing];
}