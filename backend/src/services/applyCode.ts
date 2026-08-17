import fs from "fs";
import path from "path";
import vm from "vm";
import { execFileSync } from "child_process";
import { expandHome } from "./fileReader";
import { GeneratedLayer } from "./codegen";

// Writing into someone's repository is the one thing this app refused to do for
// a long time, and the reason was never that it is hard. It is that a wrong
// write is silent: the developer finds out at the next run, in a file they did
// not open. So nothing here writes without a plan having been shown first, and
// the plan is built by the same code that performs the write, rather than being
// a description of it that can drift.

// The model chooses these paths. A path is untrusted input no matter how
// plausible it looks, and "src/../../.ssh/config" is one string away.
export class OutsideProjectError extends Error {
  constructor(rel: string) {
    super(`${rel} is outside the project folder, so nothing was written`);
    this.name = "OutsideProjectError";
  }
}

export interface FilePlan {
  layer: string;
  // project-relative, which is what the preview shows and what the model wrote
  relPath: string;
  absPath: string;
  isNew: boolean;
  // 1-indexed line the block is inserted above. null when it goes at the end,
  // either because the file has no trailing export or because it is new.
  insertAbove: number | null;
  addedLines: number;
  // top-level declarations this replaces, when the same endpoint is applied
  // again. shown in the diff so nothing is removed without being named.
  replaced?: string[];
  code: string;
  // names this block calls into that nothing in the file defines. a warning
  // shown in the diff, never a refusal: running the endpoint is what settles it.
  undefinedNames: string[];
  // routes that will be registered but never reached, because a route already
  // in the file matches first
  shadowed?: { route: string; by: string; line: number }[];
  // the whole file as it would be after the write, so the preview and the write
  // cannot disagree about what was going to happen
  nextContent: string;
}

export interface ApplyPlan {
  files: FilePlan[];
  // git is the undo story when there is one. when there is not, .reqflow.bak is.
  git: { repo: boolean; dirty: string[] };
  backups: boolean;
}

// A router file ends with the thing that exports it, and appending puts new
// routes underneath that line, where they are read but never registered. The
// endpoint then 404s while its code sits right there in the file, which is
// about the worst failure this feature could have.
const TRAILING_EXPORT = /^\s*(module\.exports\s*=|export\s+default\b|export\s*\{)/;

// Deliberately the last match rather than the first: a file can name an export
// early and still end with the one that matters.
export function insertAboveLine(content: string): number | null {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (TRAILING_EXPORT.test(lines[i])) return i + 1;
  }
  return null;
}

// How far the export statement that starts on this line runs. `module.exports =
// router;` is one line; `module.exports = {\n  list,\n  find,\n};` is four, and
// removing only its first line would leave the rest behind as a syntax error.
function statementEnd(lines: string[], start: number): number {
  let depth = 0;

  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (depth <= 0) return i;
  }

  return lines.length - 1;
}

// An export written as a list of names — `module.exports = { list, find };` —
// is the only kind that can be merged, and the only kind that needs to be. A
// router file exports its router and new routes register on that object, so
// there is nothing to add to it.
const OBJECT_EXPORT = /^(module\.exports|export\s+default)\s*=\s*\{([\s\S]*)\}\s*;?\s*$/;

function exportedNames(statement: string): string[] | null {
  const match = OBJECT_EXPORT.exec(statement.trim());
  if (!match) return null;

  return match[2]
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter(Boolean);
}

// What a block of new code adds that the file could export: its top-level
// declarations. Indented ones belong to something else and are nobody's export.
const TOP_LEVEL_DECLARATION =
  /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

export function declaredNames(code: string): string[] {
  const names: string[] = [];
  for (const line of code.split("\n")) {
    const match = TOP_LEVEL_DECLARATION.exec(line);
    if (match) names.push(match[1] || match[2]);
  }
  return names;
}

// Neither replace nor ignore. Replacing takes the file's word for nothing and
// drops every export the block did not happen to mention — a service told to add
// create stopped exporting list and find, and the routes that already worked
// broke. Ignoring leaves the file's own export last, so the new function is
// defined and never exported. Both were seen, on the same benchmark, from
// different models.
//
// A block's export list says what that block knows about, not what the file
// should expose. So it is read as an addition, and merged with what is already
// there.


// Every name the file already binds at the top level, including the destructured
// ones. `const { incidentService } = require('../services')` binds
// incidentService just as surely as `const incidentService = require(...)` does,
// and only the second form looks like a declaration to a line-by-line regex.
const DESTRUCTURED = /^(?:const|let|var)\s*\{([^}]*)\}\s*=/;

export function boundNames(code: string): Set<string> {
  const names = new Set<string>(declaredNames(code));
  for (const line of code.split("\n")) {
    const match = DESTRUCTURED.exec(line);
    if (!match) continue;
    for (const part of match[1].split(",")) {
      // { a: b } binds b, { a } binds a
      const bound = part.includes(":") ? part.split(":")[1] : part;
      const name = bound.trim().replace(/^\.\.\./, "");
      if (name) names.add(name);
    }
  }
  return names;
}

const IS_IMPORT = /require\s*\(|^\s*import\s/;

// An import the file already has, dropped from the block rather than added again.
//
// Repeated import *lines* were already stripped, but the clash here is by name,
// not by text: a router holding
// `const { incidentService } = require('../services')` was handed
// `const incidentService = require('../services/incidents')` — a different line,
// the same binding, and a file that no longer parses.
//
// The file's own wiring wins, deliberately. It is the one that is known to work,
// and replacing it with the block's guess at a module path is how code ends up
// requiring something that is not there.
export function dropKnownImports(existing: string, block: string): string {
  const known = boundNames(existing);
  if (known.size === 0) return block;

  return block
    .split("\n")
    .filter((line) => {
      if (!IS_IMPORT.test(line)) return true;
      const binds = boundNames(line);
      return ![...binds].some((name) => known.has(name));
    })
    .join("\n");
}


// A route that will never be reached.
//
// Express matches in registration order, and applied code lands below what the
// file already has. So a project whose router registers GET /:id at the top gets
// a new GET /stats underneath it — and every request for /stats is answered by
// /:id with id="stats". The file parses, the server boots, and the endpoint
// quietly returns someone else's error. Nothing downstream can catch this: the
// runtime check sees a real response with a wrong status and cannot say why.
//
// This is a warning in the diff, not a refusal. Registering a literal below a
// parameter is occasionally deliberate, and a check that blocks the developer
// from their own routing decisions is worse than one they can read and dismiss.
function routesIn(code: string): { method: string; path: string; line: number }[] {
  const found: { method: string; path: string; line: number }[] = [];
  code.split("\n").forEach((line, i) => {
    const match = ROUTE_REGISTRATION.exec(line);
    if (match) found.push({ method: match[1].toLowerCase(), path: match[2], line: i + 1 });
  });
  return found;
}

// does a path already registered swallow the one being added?
function swallows(existing: string, incoming: string): boolean {
  const a = existing.split("/").filter(Boolean);
  const b = incoming.split("/").filter(Boolean);
  if (a.length !== b.length) return false;

  let usedParam = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) {
      // a parameter matches anything, which is exactly the problem — but only
      // when the incoming segment is a literal, or the two are identical routes
      if (b[i].startsWith(":")) continue;
      usedParam = true;
      continue;
    }
    if (a[i] !== b[i]) return false;
  }
  return usedParam;
}

export function shadowedRoutes(
  existing: string,
  block: string
): { route: string; by: string; line: number }[] {
  const already = routesIn(existing);
  const warnings: { route: string; by: string; line: number }[] = [];

  for (const incoming of routesIn(block)) {
    const blocker = already.find(
      (r) =>
        (r.method === incoming.method || r.method === "all") &&
        swallows(r.path, incoming.path)
    );
    if (blocker) {
      warnings.push({
        route: `${incoming.method.toUpperCase()} ${incoming.path}`,
        by: `${blocker.method.toUpperCase()} ${blocker.path}`,
        line: blocker.line,
      });
    }
  }
  return warnings;
}

// Applying the same endpoint twice should update it, not declare it twice.
//
// The second apply used to be refused outright: the file already had
// `updatePriority`, the new block declared it again, and the parse check —
// correctly — would not write a file with a duplicate declaration. That is the
// safe answer but not the useful one, because regenerating an endpoint is
// exactly what a developer does after reading the diff and wanting it different.
//
// So a top-level declaration the new block also makes is taken out of the file
// first, and the new one takes its place. The old text is only removed when its
// braces balance; anything the scan cannot account for is left alone, and the
// parse check still has the last word.
// A route registration is not a declaration, so the rule above does not see it —
// and Express only ever runs the first match, which makes every re-apply add a
// block of code that can never execute. Four copies of the same
// router.patch('/:id/priority', ...) were found in a real project this way.
// method and path together are the identity, the same way the router reads them.
const ROUTE_REGISTRATION =
  /^\s*(?:router|app)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]*)['"`]/;

function routeKeyOf(line: string): string | null {
  const match = ROUTE_REGISTRATION.exec(line);
  return match ? `${match[1].toLowerCase()} ${match[2]}` : null;
}

export function replaceDeclarations(
  existing: string,
  block: string
): { content: string; replaced: string[] } {
  const incoming = new Set(declaredNames(block));
  const incomingRoutes = new Set(
    block.split("\n").map(routeKeyOf).filter(Boolean) as string[]
  );
  if (incoming.size === 0 && incomingRoutes.size === 0) {
    return { content: existing, replaced: [] };
  }

  const lines = existing.split("\n");
  const keep: string[] = [];
  const replaced: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = TOP_LEVEL_DECLARATION.exec(lines[i]);
    const declared = match ? match[1] || match[2] : null;
    const route = routeKeyOf(lines[i]);

    const name =
      declared && incoming.has(declared)
        ? declared
        : route && incomingRoutes.has(route)
        ? // shown to the developer, so the method reads the way a method does
          route.replace(/^(\w+)/, (m) => m.toUpperCase())
        : null;

    if (!name) {
      keep.push(lines[i]);
      continue;
    }

    // walk to the end of this declaration by counting braces. a declaration
    // whose braces never balance is one this cannot safely cut, so it stays.
    let depth = 0;
    let seenBrace = false;
    let end = -1;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++;
          seenBrace = true;
        } else if (ch === "}") depth--;
      }
      if (seenBrace && depth === 0) {
        end = j;
        break;
      }
    }

    if (end === -1) {
      keep.push(lines[i]);
      continue;
    }

    replaced.push(name);
    i = end;
    // drop a single blank line left behind, so replacing does not slowly open
    // gaps in the file every time it happens
    if (lines[i + 1] !== undefined && lines[i + 1].trim() === "") i++;
  }

  return { content: keep.join("\n"), replaced };
}

export function mergeExports(
  existingStatement: string,
  blockCode: string
): { statement: string; strippedBlock: string } | null {
  const existingNames = exportedNames(existingStatement);
  if (existingNames === null) return null;

  const blockLines = blockCode.split("\n");
  const blockExportAt = blockLines.findIndex((l) => TRAILING_EXPORT.test(l));

  let fromBlockExport: string[] = [];
  let strippedBlock = blockCode;

  if (blockExportAt >= 0) {
    const end = statementEnd(blockLines, blockExportAt);
    const statement = blockLines.slice(blockExportAt, end + 1).join("\n");
    fromBlockExport = exportedNames(statement) ?? [];
    strippedBlock = [...blockLines.slice(0, blockExportAt), ...blockLines.slice(end + 1)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const merged: string[] = [...existingNames];
  for (const name of [...fromBlockExport, ...declaredNames(strippedBlock)]) {
    if (name && !merged.includes(name)) merged.push(name);
  }

  // the file's own shape is kept: a one-line export stays one line
  const wasMultiline = existingStatement.includes("\n");
  const keyword = existingStatement.trim().startsWith("export") ? "export default" : "module.exports";
  const statement = wasMultiline
    ? `${keyword} = {\n${merged.map((n) => `  ${n},`).join("\n")}\n};`
    : `${keyword} = { ${merged.join(", ")} };`;

  return { statement, strippedBlock };
}

interface BuiltFile {
  nextContent: string;
  insertAbove: number | null;
  addedLines: number;
  replaced?: string[];
  // the block as it will actually be written, after imports the file already
  // binds have been taken out of it
  written: string;
}

// How many lines the file gains, counted rather than predicted.
//
// Each branch below worked out its own total from the pieces it was assembling,
// and one of them was over by one — the diff said +5 where the file grew by 4.
// A number the developer cannot check against the result is worse than no
// number, and this one is checkable by construction: it is the difference.
export function buildContent(existing: string | null, code: string): BuiltFile {
  const built = assembleFile(existing, code);
  if (existing === null) return built;

  return {
    ...built,
    addedLines: built.nextContent.split("\n").length - existing.split("\n").length,
  };
}

function assembleFile(existing: string | null, code: string): BuiltFile {
  let block = code.replace(/\s+$/, "");
  // counted after the block has been trimmed of what the file already has, not
  // before: a diff that says "+18 lines" and writes 17 is a diff that cannot be
  // checked against the file it describes
  let blockLines = block.split("\n").length;

  if (existing === null) {
    return {
      nextContent: `${block}\n`,
      insertAbove: null,
      addedLines: blockLines,
      replaced: [],
      written: block,
    };
  }

  // an import the file already binds is dropped from the block before anything
  // else, so it cannot become a second declaration of the same name
  block = dropKnownImports(existing, block);
  blockLines = block.split("\n").length;

  // a second apply of the same endpoint updates it rather than declaring it
  // twice, which the parse check would refuse
  const { content: withoutOld, replaced } = replaceDeclarations(existing, block);
  existing = withoutOld;

  const at = insertAboveLine(existing);
  const lines = existing.split("\n");

  // one blank line either side, so the new block reads as its own thing rather
  // than as a continuation of whatever it landed next to
  if (at === null) {
    const trimmed = existing.replace(/\s+$/, "");
    return {
      nextContent: `${trimmed}\n\n${block}\n`,
      insertAbove: null,
      addedLines: blockLines + 1,
      replaced,
      written: block,
    };
  }

  let blockLinesArray = block.split("\n");

  // The file's export, merged with what this block adds, rather than replaced by
  // it or left to win over it.
  const exportEnd = statementEnd(lines, at - 1);
  const existingStatement = lines.slice(at - 1, exportEnd + 1).join("\n");
  const mergedExport = mergeExports(existingStatement, block);

  if (mergedExport) {
    blockLinesArray = mergedExport.strippedBlock.split("\n");
    const head = lines.slice(0, at - 1);
    const tail = lines.slice(exportEnd + 1);
    const gap = head.length > 0 && head[head.length - 1].trim() === "" ? [] : [""];
    const body = mergedExport.strippedBlock.trim() ? [...gap, ...blockLinesArray, ""] : [];

    return {
      nextContent: [...head, ...body, ...mergedExport.statement.split("\n"), ...tail]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n"),
      insertAbove: at,
      addedLines: body.length,
      replaced,
      written: mergedExport.strippedBlock,
    };
  }

  // Anything the merge could not handle — a file whose export is not a list of
  // names, such as a router exporting its router object. There the block's own
  // export, if it has one, does replace: it is the same object being exported
  // and keeping both would leave the older one winning.
  const blockExportsAt = insertAboveLine(block);
  const before = lines.slice(0, at - 1);
  const after = blockExportsAt === null
    ? lines.slice(at - 1)
    : lines.slice(statementEnd(lines, at - 1) + 1);

  // the file usually already has a blank line above its export, and adding a
  // second one leaves a gap that looks like something was deleted there
  const lead = before.length > 0 && before[before.length - 1].trim() === "" ? [] : [""];
  // a replaced export ends the file, so nothing needs separating from it
  const trail = after.length > 0 && after.some((l) => l.trim()) ? [""] : [];
  const inserted = [...before, ...lead, ...blockLinesArray, ...trail, ...after];

  return {
    nextContent: inserted.join("\n").replace(/\n{3,}/g, "\n\n"),
    insertAbove: at,
    addedLines: blockLines + lead.length + trail.length,
    replaced,
    written: block,
  };
}

// Whether the file would still parse after the write. Not whether the endpoint
// works — that is what running it is for — but whether node can load the file at
// all. A generated block that redeclares a const, or closes a brace it never
// opened, does not break its own endpoint: it stops the whole file loading and
// takes every route in it down. That is the failure worth refusing before it
// reaches disk rather than reporting afterwards.
//
// Only JavaScript is checked. TypeScript needs a compiler this does not have, so
// a .ts file goes through unchecked rather than being guessed at.
const CHECKABLE = new Set([".js", ".cjs", ".mjs"]);

export function parseError(filePath: string, content: string): string | null {
  if (!CHECKABLE.has(path.extname(filePath))) return null;

  try {
    // compiled, never run: this asks node whether the source is syntactically a
    // program, and nothing in it is executed
    new vm.Script(content, { filename: filePath });
    return null;
  } catch (err: any) {
    // an ESM file parsed as a script trips on its own import, which is a fact
    // about the check rather than about the file
    const message = String(err?.message || err);
    if (/import|export/i.test(message) && /outside a module|may only appear/i.test(message)) {
      return null;
    }
    return message;
  }
}

// An early warning, deliberately not a gate. Three separate real failures were
// the same shape and none of them was a syntax error: `bodyParser.json()` in a
// project without body-parser, `app.patch(...)` inside a router file, and
// `usersService.nextId()` inside the service that *is* usersService. All three
// parse, all three load, and all three fail the moment the endpoint is called.
//
// Static analysis of JavaScript scope is a project of its own — globals,
// closures, destructuring, dynamic properties — and this is not that. It looks
// for one thing: a bare name used as `name.something()` that nothing in the
// block or the file it is joining ever introduces. Anything it is unsure about
// it stays quiet about, because running the code is the real authority and a
// warning that cries wolf is one people learn to click past.
const MEMBER_USE = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\./g;

const ALWAYS_AVAILABLE = new Set([
  // the request handler's own arguments, by convention everywhere
  "req", "res", "next", "err", "error",
  // node and the language
  "module", "exports", "require", "process", "console", "Buffer", "global",
  "globalThis", "__dirname", "__filename",
  "JSON", "Object", "Array", "String", "Number", "Boolean", "Math", "Date",
  "Promise", "Map", "Set", "RegExp", "Symbol", "BigInt", "Error", "TypeError",
  "Intl", "Reflect", "Proxy", "WeakMap", "WeakSet", "ArrayBuffer",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask",
  "fetch", "URL", "URLSearchParams", "AbortController", "structuredClone",
  "this", "self",
]);

// everything a file introduces a name by: declaring it, importing it, taking it
// as a parameter, or catching it
function namesInScope(source: string): Set<string> {
  const names = new Set<string>();

  const add = (name?: string) => {
    if (name) names.add(name);
  };

  for (const [, single, destructured] of source.matchAll(
    /(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s*\{([^}]*)\}/g
  )) {
    add(single);
    if (destructured) {
      for (const part of destructured.split(",")) {
        add(part.split(":").pop()!.split("=")[0].trim());
      }
    }
  }

  // import x, { y as z } from '...'
  for (const [, def, named] of source.matchAll(
    /import\s+([A-Za-z_$][\w$]*)?[^'"]*?(?:\{([^}]*)\})?\s*from/g
  )) {
    add(def);
    if (named) for (const part of named.split(",")) add(part.split(" as ").pop()!.trim());
  }

  // function parameters and arrow parameters, taken loosely on purpose
  for (const [, params] of source.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const part of params.split(",")) {
      const name = part.split("=")[0].replace(/[{}[\]]/g, "").split(":").pop()!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }

  for (const [, caught] of source.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(caught);

  return names;
}

export function undefinedNames(code: string, existing: string): string[] {
  const known = new Set([
    ...ALWAYS_AVAILABLE,
    ...namesInScope(existing),
    ...namesInScope(code),
  ]);

  const unknown = new Set<string>();
  for (const [, name] of code.matchAll(MEMBER_USE)) {
    // Capitalised names used to be skipped, on the reasoning that one is usually
    // a class from somewhere this cannot see. But JavaScript does not care about
    // case: `User.findById()` in a file that never binds User throws
    // ReferenceError exactly like a lowercase one would, and that is precisely
    // what shipped — a generated service calling a model it had not required,
    // answering 500 "User is not defined". The globals worth exempting are
    // already listed by name above, which is a better answer than a rule about
    // capital letters.
    if (!known.has(name)) unknown.add(name);
  }

  return [...unknown];
}

function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new OutsideProjectError(rel);
  }
  return abs;
}

function findGitRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Read-only, and the list is shown rather than acted on: a repo with work in
// progress is not a reason to refuse, it is a reason to say so before the
// developer's own uncommitted changes get mixed in with ours.
export function gitState(projectPath: string): { repo: boolean; dirty: string[] } {
  const root = findGitRoot(projectPath);
  if (!root) return { repo: false, dirty: [] };

  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf-8",
      timeout: 5000,
    });
    const dirty = out
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    return { repo: true, dirty };
  } catch {
    // git missing, or a repo it will not talk about. the folder still has a
    // .git in it, so claiming there is no repo would be worse than an empty list
    return { repo: true, dirty: [] };
  }
}

export function planApply(rawProjectPath: string, layers: GeneratedLayer[]): ApplyPlan {
  const root = path.resolve(expandHome(rawProjectPath));

  if (!fs.existsSync(root)) {
    throw new Error(`path not found: ${root}`);
  }

  const git = gitState(root);
  const files: FilePlan[] = [];
  // Two layers can name the same file — a model that decides the service and the
  // helper both live in services/users.js is not wrong, it is just writing one
  // file in two parts. Planned separately they would each be built against the
  // original, and the second write would land on a file the first had already
  // changed. Folded together, the second block is planned against the first's
  // result, which is what the developer will actually get.
  const merged: GeneratedLayer[] = [];
  for (const layer of layers) {
    const at = merged.findIndex((m) => m.path === layer.path);
    if (at >= 0) merged[at] = { ...merged[at], code: `${merged[at].code}\n\n${layer.code}` };
    else merged.push({ ...layer });
  }

  for (const layer of merged) {
    const absPath = resolveInside(root, layer.path);
    const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : null;
    const built = buildContent(existing, layer.code);

    files.push({
      layer: layer.layer,
      relPath: path.relative(root, absPath),
      absPath,
      isNew: existing === null,
      insertAbove: built.insertAbove,
      addedLines: built.addedLines,
      // named in the diff, because code taken out of the developer's file must
      // be as visible as code put in
      replaced: built.replaced || [],
      // what the write will actually put in the file, not what the model
      // handed over: a diff showing a line that never lands is a diff the
      // developer cannot check against the result
      code: built.written,
      undefinedNames: undefinedNames(built.written, existing ?? ""),
      // routes the file will register but never reach, because something above
      // them already matches. nothing downstream can catch this: the endpoint
      // answers, with someone else's response.
      shadowed: shadowedRoutes(existing ?? "", built.written),
      nextContent: built.nextContent,
    });
  }

  return { files, git, backups: !git.repo };
}

export interface AppliedFile {
  relPath: string;
  isNew: boolean;
  addedLines: number;
  backup: string | null;
}

export const BACKUP_SUFFIX = ".reqflow.bak";

// Takes a plan built here, never one sent by a client: absPath and nextContent
// decide what lands where, and accepting those over the wire would make this a
// write-anything endpoint with a preview step in front of it.
//
// It catches a file appearing or disappearing between the preview and the
// apply, which is the cheap half of the staleness problem. It does not catch a
// file that was edited in place — for that the git warning and the backup are
// what the developer has.
export function applyPlan(plan: ApplyPlan): AppliedFile[] {
  const applied: AppliedFile[] = [];

  for (const file of plan.files) {
    const existsNow = fs.existsSync(file.absPath);
    if (existsNow !== !file.isNew) {
      throw new Error(
        `${file.relPath} changed on disk since the preview was built. Nothing was written; generate the preview again.`
      );
    }

    // checked here rather than while planning, because the preview should show
    // what the model wrote even when it is wrong — reading it is how the
    // developer learns what happened
    const broken = parseError(file.absPath, file.nextContent);
    if (broken) {
      throw new Error(
        `${file.relPath} would not parse after this change, so nothing was written: ${broken}`
      );
    }

    let backup: string | null = null;
    if (existsNow && plan.backups) {
      backup = `${file.absPath}${BACKUP_SUFFIX}`;
      fs.copyFileSync(file.absPath, backup);
    }

    fs.mkdirSync(path.dirname(file.absPath), { recursive: true });
    fs.writeFileSync(file.absPath, file.nextContent, "utf-8");

    applied.push({
      relPath: file.relPath,
      isNew: file.isNew,
      addedLines: file.addedLines,
      backup: backup ? path.basename(backup) : null,
    });
  }

  return applied;
}
