import { DetectedRoute } from "../types";
import { deriveFileRoutes } from "./frameworkRoutes";
import { getProvider, stripFences } from "./llm";

// Which model reads the code is decided by LLM_PROVIDER, so a scan can run
// against a model on this machine and never send the project anywhere. The
// prompt below is the same either way: it asks for JSON and nothing else, which
// is the one thing every model here can be held to.

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

// A hosted model takes the whole project in one prompt. A model on a laptop
// cannot: the scan is allowed 800k characters of source and a local context is
// a few thousand tokens, so the choice is between batching and a local scan
// that only ever works on toy projects.
//
// Split on whole files, never inside one. Half a router tells the model about
// routes whose handlers it cannot see, and the routes it invents to fill the
// gap are worse than the ones it would have missed.
export function batchFiles(
  files: { path: string; content: string }[],
  maxChars: number
): { path: string; content: string }[][] {
  if (!maxChars || maxChars <= 0) return files.length ? [files] : [];

  const batches: { path: string; content: string }[][] = [];
  let current: { path: string; content: string }[] = [];
  let size = 0;

  for (const file of files) {
    // a single file over the limit still goes, alone. it will be refused by the
    // provider with a reason, which is better than being silently dropped from
    // a scan that then reports the project has fewer endpoints than it has.
    if (current.length > 0 && size + file.content.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += file.content.length;
  }

  if (current.length) batches.push(current);
  return batches;
}

export async function analyzeCode(files: { path: string; content: string }[]): Promise<DetectedRoute[]> {
  const provider = getProvider("analyze");

  // room for the prompt around the code, which is about 2k characters
  const budget = provider.maxPromptChars ? provider.maxPromptChars - 2500 : 0;
  const batches = batchFiles(files, budget);

  const found: DetectedRoute[] = [];
  for (const batch of batches) {
    found.push(...(await analyzeBatch(provider, batch)));
  }

  // deduped across batches: a route registered in one file and mounted in
  // another can be reported twice, and two rows for one endpoint reads as the
  // project having a duplicate it does not have
  const seen = new Set<string>();
  const routes = found.filter((r) => {
    const key = `${String(r.method).toUpperCase()} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return mergeFileRoutes(routes, deriveFileRoutes(files));
}

async function analyzeBatch(
  provider: ReturnType<typeof getProvider>,
  files: { path: string; content: string }[]
): Promise<DetectedRoute[]> {
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

  // clean up in case the model wraps it in backticks, which every one of them
  // does sooner or later however plainly it was asked not to
  const cleaned = stripFences(await provider.generateText(prompt));

  let parsed: DetectedRoute[];
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error(`${provider.name} returned bad json:`, cleaned);
    parsed = [];
  }

  return Array.isArray(parsed) ? parsed : [];
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