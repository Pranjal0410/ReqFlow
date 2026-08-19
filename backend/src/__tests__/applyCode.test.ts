import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  planApply,
  applyPlan,
  buildContent,
  insertAboveLine,
  gitState,
  OutsideProjectError,
  BACKUP_SUFFIX,
  parseError,
  undefinedNames,
  replaceDeclarations,
  boundNames,
  dropKnownImports,
  shadowedRoutes,
} from "../services/applyCode";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-apply-"));
}

const ROUTER_FILE = `const express = require('express');
const router = express.Router();

router.get('/', list);

module.exports = router;
`;

describe("insertAboveLine", () => {
  it("finds the export a router file ends with", () => {
    // 1-indexed, and ROUTER_FILE's module.exports is the sixth line
    expect(insertAboveLine(ROUTER_FILE)).toBe(6);
  });

  it("recognises the esm spellings too", () => {
    expect(insertAboveLine("const r = 1;\nexport default r;\n")).toBe(2);
    expect(insertAboveLine("const r = 1;\nexport { r };\n")).toBe(2);
  });

  it("takes the last export, not the first", () => {
    const file = "export { a };\nconst b = 2;\nexport default b;\n";
    expect(insertAboveLine(file)).toBe(3);
  });

  it("is not fooled by a named export declaration", () => {
    expect(insertAboveLine("export function handler() {}\n")).toBeNull();
  });

  it("says nothing when the file has no trailing export", () => {
    expect(insertAboveLine("const a = 1;\n")).toBeNull();
  });
});

describe("buildContent", () => {
  // the failure this exists to prevent: code appended under module.exports is
  // read by node and registered by nobody, so the endpoint 404s with its own
  // source sitting in the file
  it("puts the block above the export rather than after it", () => {
    const { nextContent, insertAbove } = buildContent(ROUTER_FILE, "router.post('/', create);");
    const lines = nextContent.split("\n");

    expect(insertAbove).toBe(6);
    expect(lines.indexOf("router.post('/', create);")).toBeLessThan(
      lines.findIndex((l) => l.startsWith("module.exports"))
    );
  });

  // a file that already ends "});\n\nmodule.exports" does not need a second
  // blank line above the export: the gap reads as something having been removed
  it("does not double the blank line the file already had", () => {
    const { nextContent } = buildContent(ROUTER_FILE, "router.post('/', create);");
    expect(nextContent).not.toContain("\n\n\n");
  });

  it("opens a gap when the export sits straight under code", () => {
    const tight = "const r = 1;\nmodule.exports = r;\n";
    expect(buildContent(tight, "const x = 2;").nextContent).toBe(
      "const r = 1;\n\nconst x = 2;\n\nmodule.exports = r;\n"
    );
  });

  it("appends when there is no export to sit above", () => {
    const { nextContent, insertAbove } = buildContent("const a = 1;\n", "const b = 2;");
    expect(insertAbove).toBeNull();
    expect(nextContent).toBe("const a = 1;\n\nconst b = 2;\n");
  });

  it("writes a new file as just the block", () => {
    const { nextContent, isNew } = { ...buildContent(null, "const a = 1;"), isNew: true };
    expect(nextContent).toBe("const a = 1;\n");
    expect(isNew).toBe(true);
  });
});

describe("planApply", () => {
  it("refuses a path that climbs out of the project", () => {
    const root = tempProject();
    expect(() =>
      planApply(root, [{ layer: "router", path: "../escaped.js", code: "x" }])
    ).toThrow(OutsideProjectError);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses an absolute path outside the project", () => {
    const root = tempProject();
    expect(() =>
      planApply(root, [{ layer: "router", path: "/etc/hosts", code: "x" }])
    ).toThrow(OutsideProjectError);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes nothing while planning", () => {
    const root = tempProject();
    planApply(root, [{ layer: "service", path: "src/services/new.js", code: "const a = 1;" }]);
    expect(fs.existsSync(path.join(root, "src/services/new.js"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("marks an existing file as not new and a missing one as new", () => {
    const root = tempProject();
    fs.writeFileSync(path.join(root, "routes.js"), ROUTER_FILE);

    const plan = planApply(root, [
      { layer: "router", path: "routes.js", code: "router.post('/', create);" },
      { layer: "service", path: "services/new.js", code: "const a = 1;" },
    ]);

    expect(plan.files[0].isNew).toBe(false);
    expect(plan.files[1].isNew).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("applyPlan", () => {
  it("creates directories a new layer file needs", () => {
    const root = tempProject();
    applyPlan(planApply(root, [{ layer: "service", path: "src/services/new.js", code: "const a = 1;" }]));
    expect(fs.readFileSync(path.join(root, "src/services/new.js"), "utf-8")).toBe("const a = 1;\n");
    fs.rmSync(root, { recursive: true, force: true });
  });

  // a folder with no git in it has no undo, so one is made
  it("backs up an edited file when the project is not a repo", () => {
    const root = tempProject();
    const file = path.join(root, "routes.js");
    fs.writeFileSync(file, ROUTER_FILE);

    const applied = applyPlan(
      planApply(root, [{ layer: "router", path: "routes.js", code: "router.post('/', create);" }])
    );

    expect(applied[0].backup).toBe(`routes.js${BACKUP_SUFFIX}`);
    expect(fs.readFileSync(`${file}${BACKUP_SUFFIX}`, "utf-8")).toBe(ROUTER_FILE);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("leaves no backup behind when git already is one", () => {
    const root = tempProject();
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, "routes.js"), ROUTER_FILE);

    const plan = planApply(root, [
      { layer: "router", path: "routes.js", code: "router.post('/', create);" },
    ]);
    expect(plan.backups).toBe(false);

    const applied = applyPlan(plan);
    expect(applied[0].backup).toBeNull();
    expect(fs.existsSync(path.join(root, `routes.js${BACKUP_SUFFIX}`))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("stops when a planned new file appeared in the meantime", () => {
    const root = tempProject();
    const plan = planApply(root, [{ layer: "service", path: "new.js", code: "const a = 1;" }]);

    fs.writeFileSync(path.join(root, "new.js"), "someone else got here first");
    expect(() => applyPlan(plan)).toThrow(/changed on disk/);
    expect(fs.readFileSync(path.join(root, "new.js"), "utf-8")).toBe("someone else got here first");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("gitState", () => {
  it("reports a plain folder as no repo", () => {
    const root = tempProject();
    expect(gitState(root)).toEqual({ repo: false, dirty: [] });
    fs.rmSync(root, { recursive: true, force: true });
  });

  // the warning exists so our write is not mixed into work in progress
  it("lists uncommitted work in a repo", () => {
    const root = tempProject();
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, "wip.js"), "half done");

    const state = gitState(root);
    expect(state.repo).toBe(true);
    expect(state.dirty).toContain("wip.js");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// A generated block that redeclares a const or closes a brace it never opened
// does not break its own endpoint. It stops the file loading, which takes every
// route in that file down with it — and the developer is left with a project
// that will not start and a diff they already approved.
describe("parseError", () => {
  it("passes a file that would still load", () => {
    expect(parseError("routes.js", "const a = 1;\nmodule.exports = a;\n")).toBeNull();
  });

  it("catches a const the file would now declare twice", () => {
    const after = "const router = 1;\nconst router = 2;\n";
    expect(parseError("routes.js", after)).toMatch(/already been declared|Identifier/i);
  });

  it("catches an unclosed block", () => {
    expect(parseError("routes.js", "router.post('/', (req, res) => {\n")).toBeTruthy();
  });

  // a compiler this does not have would be needed, and guessing is worse than
  // letting it through to the diff the developer reads
  it("leaves typescript alone rather than guessing", () => {
    expect(parseError("routes.ts", "const x: number = 1;")).toBeNull();
  });

  // esm parsed as a script trips on its own import, which says nothing about
  // whether the file is fine
  it("does not fail an esm file for being esm", () => {
    expect(parseError("routes.mjs", "import express from 'express';\nexport default 1;\n")).toBeNull();
  });
});

// The failure that survived every other check. A service told to export a new
// function writes the whole export list again; inserted above the file's own
// export, the original runs last and wins, so the new function is defined and
// never exported. It parses, the server boots, and the endpoint answers
// "usersService.create is not a function" — only calling it finds this.
describe("buildContent when the block restates the export", () => {
  const SERVICE = `const users = [];

function list() {
  return users;
}

module.exports = { list };
`;

  it("replaces the old export rather than queueing behind it", () => {
    const block = `function create(data) {
  users.push(data);
  return data;
}

module.exports = { list, create };`;

    const { nextContent } = buildContent(SERVICE, block);
    expect(nextContent.match(/module\.exports/g)).toHaveLength(1);
    expect(nextContent).toContain("module.exports = { list, create };");
    expect(nextContent).toContain("function create(data)");
  });

  it("removes a multi-line export whole, not just its first line", () => {
    const multi = `const a = 1;

module.exports = {
  a,
};
`;
    const { nextContent } = buildContent(multi, "const b = 2;\n\nmodule.exports = {\n  a,\n  b,\n};");
    expect(nextContent.match(/module\.exports/g)).toHaveLength(1);
    // the tail of the replaced statement must not be left behind
    expect(nextContent).not.toMatch(/^\s*\};\s*$\n\s*module\.exports/m);
    expect(nextContent.trimEnd().endsWith("};")).toBe(true);
    expect(nextContent).toContain("b,");
  });

  it("still inserts above when the block adds no export of its own", () => {
    const router = `const router = require('express').Router();

router.get('/', list);

module.exports = router;
`;
    const { nextContent } = buildContent(router, "router.post('/', create);");
    const lines = nextContent.split("\n");
    expect(lines.indexOf("router.post('/', create);")).toBeLessThan(
      lines.findIndex((l) => l.startsWith("module.exports"))
    );
    expect(nextContent.match(/module\.exports/g)).toHaveLength(1);
  });

  it("handles an esm default export the same way", () => {
    const file = "const a = 1;\n\nexport default { a };\n";
    const { nextContent } = buildContent(file, "const b = 2;\n\nexport default { a, b };");
    expect(nextContent.match(/export default/g)).toHaveLength(1);
    expect(nextContent).toContain("export default { a, b };");
  });
});

// A model can decide two layers belong in one file. Planned separately, each is
// built against the original and the second write lands on a file the first has
// already changed — refused as "changed on disk", which is true and useless.
describe("planApply with two layers in one file", () => {
  it("folds them into a single change", () => {
    const root = tempProject();
    fs.writeFileSync(path.join(root, "svc.js"), "const a = 1;\n\nmodule.exports = { a };\n");

    const plan = planApply(root, [
      { layer: "service", path: "svc.js", code: "function b() {}" },
      { layer: "helper", path: "svc.js", code: "function c() {}" },
    ]);

    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].nextContent).toContain("function b()");
    expect(plan.files[0].nextContent).toContain("function c()");

    applyPlan(plan);
    const after = fs.readFileSync(path.join(root, "svc.js"), "utf-8");
    expect(after).toContain("function b()");
    expect(after).toContain("function c()");
    expect(after.match(/module\.exports/g)).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// The failure that dominated a whole 60-generation benchmark, from every model
// at once, in two opposite directions:
//
//   the block restates a partial export  -> replacing it deleted list and find,
//                                           and routes that already worked broke
//   the block restates no export at all  -> the file's own export ran last, so
//                                           the new function was never exported
//
// Neither replace nor ignore. A block's export list says what that block knows
// about, not what the file should expose, so it is merged.
describe("export merging", () => {
  const SERVICE = `const users = [];

function list() {
  return users;
}

function find(id) {
  return users.find((u) => u.id === id);
}

module.exports = { list, find, users };
`;

  const exportsOf = (content: string) => {
    const line = content.split("\n").find((l) => l.includes("module.exports"))!;
    // single-line form in these fixtures
    return line
      .replace(/.*\{|\}.*/g, "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
  };

  it("exports a new function the block never mentioned exporting", () => {
    const { nextContent } = buildContent(SERVICE, "function create(data) {\n  users.push(data);\n}");
    expect(exportsOf(nextContent)).toEqual(["list", "find", "users", "create"]);
  });

  it("keeps the existing exports when the block lists only its own", () => {
    const block = "function create(data) {\n  users.push(data);\n}\n\nmodule.exports = { create };";
    const { nextContent } = buildContent(SERVICE, block);

    // the whole point: list and find are still exported
    expect(exportsOf(nextContent)).toEqual(["list", "find", "users", "create"]);
    expect(nextContent.match(/module\.exports/g)).toHaveLength(1);
  });

  it("takes names from the block's own list even when nothing is declared for them", () => {
    const { nextContent } = buildContent(SERVICE, "module.exports = { list, find, users, remove };");
    expect(exportsOf(nextContent)).toContain("remove");
  });

  it("leaves the export alone when the block adds no top-level name", () => {
    const { nextContent } = buildContent(SERVICE, "// a note about the file");
    expect(exportsOf(nextContent)).toEqual(["list", "find", "users"]);
  });

  // applying the same change twice must not grow the export list
  it("is idempotent", () => {
    const block = "function create(data) {\n  users.push(data);\n}\n\nmodule.exports = { create };";
    const once = buildContent(SERVICE, block).nextContent;
    const twice = buildContent(once, block).nextContent;

    expect(exportsOf(twice)).toEqual(["list", "find", "users", "create"]);
    expect(twice.match(/module\.exports/g)).toHaveLength(1);
  });

  it("does not try to merge a router that exports its router object", () => {
    const router = `const router = require('express').Router();

router.get('/', list);

module.exports = router;
`;
    const { nextContent } = buildContent(router, "router.post('/', create);");
    expect(nextContent).toContain("module.exports = router;");
    expect(nextContent.match(/module\.exports/g)).toHaveLength(1);
    const lines = nextContent.split("\n");
    expect(lines.indexOf("router.post('/', create);")).toBeLessThan(
      lines.findIndex((l) => l.startsWith("module.exports"))
    );
  });

  it("keeps a multi-line export multi-line", () => {
    const multi = `const a = 1;

module.exports = {
  a,
};
`;
    const { nextContent } = buildContent(multi, "function b() {}");
    expect(nextContent).toContain("module.exports = {");
    expect(nextContent).toMatch(/^\s{2}b,$/m);
    expect(nextContent.match(/module\.exports/g)).toHaveLength(1);
  });

  it("ignores a name declared inside another function", () => {
    const block = "function create(data) {\n  const helper = 1;\n  return helper;\n}";
    const { nextContent } = buildContent(SERVICE, block);
    expect(exportsOf(nextContent)).not.toContain("helper");
    expect(exportsOf(nextContent)).toContain("create");
  });
});

// Three separate real failures, none of them a syntax error, all the same
// shape: a name used as `name.something()` that nothing in the file defines.
// Every one of them parsed, loaded, and failed the moment the endpoint was
// called — which is why this is a warning shown in the diff rather than a gate.
describe("undefinedNames", () => {
  const ROUTER = `const express = require('express');
const router = express.Router();
const usersService = require('../services/users');
`;

  it("catches a library the project does not have", () => {
    expect(undefinedNames("router.post('/', bodyParser.json(), h);", ROUTER)).toContain("bodyParser");
  });

  it("catches app inside a router file", () => {
    expect(undefinedNames("app.patch('/:id', handler);", ROUTER)).toContain("app");
  });

  // the one that actually reached a booted server: the service calling itself
  // by the router's name for it
  it("catches a file referring to itself by another file's variable", () => {
    const SERVICE = "const users = [];\nfunction nextId() { return 1; }\n";
    expect(undefinedNames("function create() { return usersService.nextId(); }", SERVICE)).toContain(
      "usersService"
    );
  });

  it("says nothing about what the file does define", () => {
    expect(undefinedNames("router.post('/', (req, res) => usersService.list());", ROUTER)).toEqual([]);
  });

  it("says nothing about the handler's own arguments", () => {
    expect(undefinedNames("router.get('/', (req, res) => res.json(req.body));", ROUTER)).toEqual([]);
  });

  it("counts a name the block itself introduces", () => {
    const code = "const helper = require('../lib/helper');\nrouter.get('/', () => helper.run());";
    expect(undefinedNames(code, ROUTER)).toEqual([]);
  });

  it("stays quiet about language and node globals", () => {
    const code = "router.get('/', () => { console.log(JSON.stringify(Date.now())); Math.max(1, 2); });";
    expect(undefinedNames(code, ROUTER)).toEqual([]);
  });

  // This used to assert the opposite, and the assertion was the bug: a
  // capitalised name was waved through on the reasoning that it is probably a
  // class from elsewhere. JavaScript does not care about case, and a generated
  // service shipped calling User.findById() without requiring User — 500 "User
  // is not defined", from the one check meant to catch it. The globals worth
  // exempting are listed by name, which is a better answer than a rule about
  // capital letters.
  it("flags a capitalised name the file never binds", () => {
    expect(undefinedNames("const s = Sequelize.define('x');", ROUTER)).toEqual(["Sequelize"]);
  });

  it("stays quiet once that name is required", () => {
    const file = `${ROUTER}const Sequelize = require('sequelize');\n`;
    expect(undefinedNames("const s = Sequelize.define('x');", file)).toEqual([]);
  });

  it("sees a destructured import as defining its names", () => {
    const file = `${ROUTER}const { required } = require('../lib/validate');\n`;
    expect(undefinedNames("router.post('/', () => required.check());", file)).toEqual([]);
  });
});

// The warning is unit-tested above, but a check nobody can see is not a warning.
// Gemini writes clean code, so it had never once appeared on screen — this makes
// it appear on demand, through the same route the diff preview calls.
describe("the plan carries its warnings to the caller", () => {
  const ROUTER = `const express = require('express');
const router = express.Router();
const usersService = require('../services/users');

module.exports = router;
`;

  it("reports a name the file does not define", () => {
    const root = tempProject();
    fs.writeFileSync(path.join(root, "routes.js"), ROUTER);

    const plan = planApply(root, [
      {
        layer: "router",
        path: "routes.js",
        // the failure that reached a booted server: valid syntax, undefined name
        code: "router.post('/', bodyParser.json(), (req, res) => res.json({}));",
      },
    ]);

    expect(plan.files[0].undefinedNames).toContain("bodyParser");
    // and it is a warning, not a refusal: the file still parses, so the write is
    // allowed and running the endpoint is what settles it
    expect(parseError(plan.files[0].absPath, plan.files[0].nextContent)).toBeNull();

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("says nothing when the block only uses what the file has", () => {
    const root = tempProject();
    fs.writeFileSync(path.join(root, "routes.js"), ROUTER);

    const plan = planApply(root, [
      {
        layer: "router",
        path: "routes.js",
        code: "router.get('/x', (req, res) => res.json(usersService.list()));",
      },
    ]);

    expect(plan.files[0].undefinedNames).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// Applying the same endpoint a second time used to be refused: the file already
// declared the function, the new block declared it again, and the parse check
// would not write a file with a duplicate declaration. Correct, but a dead end —
// regenerating after reading the diff is exactly what a developer does.
describe("replaceDeclarations", () => {
  const existing = `const express = require('express');

async function updatePriority(id, priority) {
  return { id, priority, old: true };
}

async function listIncidents() {
  return [];
}

module.exports = { updatePriority, listIncidents };
`;

  it("takes out the old declaration so the new one can take its place", () => {
    const block = `async function updatePriority(id, priority) {
  return { id, priority, old: false };
}`;
    const { content, replaced } = replaceDeclarations(existing, block);
    expect(replaced).toEqual(["updatePriority"]);
    expect(content).not.toContain("old: true");
    // and nothing else was touched
    expect(content).toContain("async function listIncidents()");
    expect(content).toContain("const express = require('express');");
    expect(content).toContain("module.exports = { updatePriority, listIncidents };");
  });

  it("leaves a file alone when the block declares nothing it already has", () => {
    const block = `async function deleteIncident(id) {\n  return id;\n}`;
    const { content, replaced } = replaceDeclarations(existing, block);
    expect(replaced).toEqual([]);
    expect(content).toBe(existing);
  });

  it("does not cut a declaration whose braces it cannot account for", () => {
    // a truncated file is exactly where a brace-counting cut would do damage
    const truncated = `async function updatePriority(id) {\n  if (id) {\n`;
    const block = `async function updatePriority(id) {\n  return id;\n}`;
    const { content, replaced } = replaceDeclarations(truncated, block);
    expect(replaced).toEqual([]);
    expect(content).toBe(truncated);
  });

  it("replaces an arrow function assigned to a const", () => {
    const arrow = `const updatePriority = async (id) => {\n  return id;\n};\n`;
    const block = `const updatePriority = async (id) => {\n  return { id };\n};`;
    const { replaced } = replaceDeclarations(arrow, block);
    expect(replaced).toEqual(["updatePriority"]);
  });
});

// the whole point of the above: the second apply must now produce a file that parses
describe("applying the same endpoint twice", () => {
  it("updates the function instead of declaring it a second time", () => {
    const first = `const express = require('express');

module.exports = {};
`;
    const block = `async function updatePriority(id) {
  return id;
}

module.exports = { updatePriority };`;

    const once = buildContent(first, block).nextContent;
    const twice = buildContent(once, block).nextContent;

    const declarations = twice.match(/async function updatePriority/g) || [];
    expect(declarations).toHaveLength(1);
    expect(parseError("incidents.js", twice)).toBeNull();
  });
});

// Express runs the first route that matches and ignores the rest, so a re-applied
// router block does not just clutter the file — it adds code that can never run.
// A real project was found with four copies of the same registration, three of
// them dead, because a route registration is a call and not a declaration.
describe("re-applying a route registration", () => {
  const router = `const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json([]);
});

router.patch('/:id/priority', async (req, res) => {
  res.json({ old: true });
});

module.exports = router;
`;

  it("replaces the registration instead of adding a second one", () => {
    const block = `router.patch('/:id/priority', async (req, res) => {
  res.json({ old: false });
});`;
    const { content, replaced } = replaceDeclarations(router, block);
    expect(replaced).toEqual(["PATCH /:id/priority"]);
    expect(content).not.toContain("old: true");
    // the route that was not re-applied is untouched
    expect(content).toContain("router.get('/', async (req, res) => {");
  });

  it("treats a different path on the same method as a different route", () => {
    const block = `router.patch('/:id/status', async (req, res) => {\n  res.json({});\n});`;
    const { replaced } = replaceDeclarations(router, block);
    expect(replaced).toEqual([]);
  });

  it("treats a different method on the same path as a different route", () => {
    const block = `router.post('/:id/priority', async (req, res) => {\n  res.json({});\n});`;
    const { replaced } = replaceDeclarations(router, block);
    expect(replaced).toEqual([]);
  });

  it("leaves one registration after any number of applies", () => {
    const block = `router.patch('/:id/priority', async (req, res) => {
  res.json({ n: 1 });
});`;
    let file = router;
    for (let i = 0; i < 4; i++) file = buildContent(file, block).nextContent;

    const registrations = file.match(/router\.patch\('\/:id\/priority'/g) || [];
    expect(registrations).toHaveLength(1);
    expect(parseError("incidents.js", file)).toBeNull();
  });
});

// The clash that got past the line-by-line import stripper: same binding,
// different text. A router holding
// `const { incidentService, presenceService } = require('../services')` was
// handed `const incidentService = require('../services/incidents')`, and the
// file stopped parsing on a name it already had.
describe("imports the file already binds", () => {
  const router = `const express = require('express');
const router = express.Router();
const { incidentService, presenceService } = require('../services');
const { authenticateHTTP, requireRole } = require('../middleware/auth');

module.exports = router;
`;

  it("sees names bound by destructuring, not just plain consts", () => {
    const names = boundNames(router);
    expect(names.has("incidentService")).toBe(true);
    expect(names.has("presenceService")).toBe(true);
    expect(names.has("requireRole")).toBe(true);
    expect(names.has("express")).toBe(true);
  });

  it("drops a require that rebinds a name the file already has", () => {
    const block = `const incidentService = require('../services/incidents');

router.post('/:id/resolve', async (req, res) => {
  res.json({});
});`;
    const kept = dropKnownImports(router, block);
    expect(kept).not.toContain("require('../services/incidents')");
    // and the code that mattered is untouched
    expect(kept).toContain("router.post('/:id/resolve'");
  });

  it("keeps a require for something the file does not have", () => {
    const block = `const logger = require('../lib/logger');\nrouter.get('/x', () => {});`;
    expect(dropKnownImports(router, block)).toContain("require('../lib/logger')");
  });

  it("never drops a line that is not an import", () => {
    // a function sharing a name is replaced, not silently deleted
    const block = `const incidentService = { resolve() { return 1; } };`;
    expect(dropKnownImports(router, block)).toBe(block);
  });

  it("does not count the dropped line as a line it added", () => {
    const block = `const incidentService = require('../services/incidents');\nrouter.get('/y', () => {});`;
    // two lines in, one dropped, so one line is added
    expect(buildContent(router, block).addedLines).toBeLessThan(3);
  });

  it("produces a file that parses, which is the whole point", () => {
    const block = `const incidentService = require('../services/incidents');

router.post('/:id/resolve', async (req, res) => {
  const out = await incidentService.resolve(req.params.id);
  res.json(out);
});`;
    const next = buildContent(router, block).nextContent;
    expect(parseError("incidents.js", next)).toBeNull();
    // one binding of the name, the file's own — the block's copy is gone
    expect((next.match(/incidentService/g) || []).length).toBe(2); // the require, and the call
    expect(next).not.toContain("require('../services/incidents')");
  });
});

// The diff is the thing the developer approves, so it has to be the thing that
// happens. When a require was dropped because the file already bound the name,
// the preview still showed that line — a line the write would never make.
describe("the diff and the write agree", () => {
  it("shows the block without the import it is going to drop", () => {
    const router = `const express = require('express');
const { incidentService } = require('../services');

module.exports = router;
`;
    const block = `const incidentService = require('../services/incidents');

router.post('/:id/resolve', async (req, res) => {
  res.json(await incidentService.resolve(req.params.id));
});`;

    const built = buildContent(router, block);
    expect(built.written).not.toContain("require('../services/incidents')");
    expect(built.written).toContain("router.post('/:id/resolve'");
    // and what is shown is what lands
    expect(built.nextContent).toContain(built.written.trim().split("\n")[0]);

    // the count the diff prints is the count the file actually gains — the only
    // version of this claim a developer can check against the result
    const grew = built.nextContent.split("\n").length - router.split("\n").length;
    expect(built.addedLines).toBe(grew);
  });
});

// The failure nothing downstream can catch. Express matches in registration
// order and applied code lands below what the file already has, so a router that
// registers GET /:id at the top swallows a new GET /stats underneath it. The
// file parses, the server boots, and /stats is answered by /:id with id="stats".
describe("routes that will never be reached", () => {
  const router = `const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => res.json([]));
router.get('/:id', async (req, res) => res.json({}));
router.patch('/:id/status', async (req, res) => res.json({}));

module.exports = router;
`;

  it("warns that a bare segment lands under an existing parameter", () => {
    const block = `router.get('/stats', async (req, res) => res.json({}));`;
    const [warning] = shadowedRoutes(router, block);
    expect(warning.route).toBe("GET /stats");
    expect(warning.by).toBe("GET /:id");
    expect(warning.line).toBe(5);
  });

  it("says nothing about a sub-path under the parameter, which is reachable", () => {
    // /:id/timeline does not collide with /:id — this is why it is the safe shape
    const block = `router.get('/:id/timeline', async (req, res) => res.json([]));`;
    expect(shadowedRoutes(router, block)).toEqual([]);
  });

  it("does not confuse one method for another", () => {
    // POST /stats is not swallowed by GET /:id
    const block = `router.post('/stats', async (req, res) => res.json({}));`;
    expect(shadowedRoutes(router, block)).toEqual([]);
  });

  it("compares whole paths, not just the first segment", () => {
    const block = `router.patch('/:id/priority', async (req, res) => res.json({}));`;
    // /:id/status does not match /:id/priority
    expect(shadowedRoutes(router, block)).toEqual([]);
  });

  it("warns on a deeper literal under a parameter too", () => {
    const block = `router.patch('/:id/status', async (req, res) => res.json({}));`;
    // identical routes are handled by replacement, not shadowing
    expect(shadowedRoutes(router, block)).toEqual([]);

    const other = `router.patch('/current/status', async (req, res) => res.json({}));`;
    expect(shadowedRoutes(router, other)[0].by).toBe("PATCH /:id/status");
  });

  it("says nothing for a file that registers no routes at all", () => {
    expect(shadowedRoutes("const x = 1;", "router.get('/stats', () => {});")).toEqual([]);
  });
});

// The warning skipped capitalised names, on the reasoning that one is usually a
// class from elsewhere. JavaScript does not care about case: a generated service
// called User.findById() without requiring User and answered 500 "User is not
// defined" — the exact failure this check exists to catch, waved through by a
// rule about capital letters.
describe("undefined identifiers, whatever their case", () => {
  const service = `const Incident = require('../models/Incident');

const listAll = async () => Incident.find();

module.exports = { listAll };
`;

  it("flags a model the file never required", () => {
    const block = `const setCommander = async (id, userId) => {
  const user = await User.findById(userId);
  return user;
};`;
    expect(undefinedNames(block, service)).toContain("User");
  });

  it("says nothing about a model the file does require", () => {
    const block = `const findOne = async (id) => Incident.findById(id);`;
    expect(undefinedNames(block, service)).not.toContain("Incident");
  });

  it("says nothing about a model the block requires itself", () => {
    const block = `const User = require('../models/User');
const setCommander = async (id) => User.findById(id);`;
    expect(undefinedNames(block, service)).not.toContain("User");
  });

  it("does not cry wolf about the language's own globals", () => {
    const block = `const stamp = () => ({ at: Date.now(), id: Math.random(), body: JSON.stringify({}) });`;
    expect(undefinedNames(block, service)).toEqual([]);
  });

  it("still catches a lowercase one, as it always did", () => {
    const block = `const go = async () => userService.list();`;
    expect(undefinedNames(block, service)).toContain("userService");
  });
});

// Warning about a route that can never be reached was right, and was not enough:
// the same endpoint was applied three times and landed in the same dead spot
// each time, below the /:id that swallows it. Express's own matching rule says
// where it has to go, so that is where it goes.
describe("a route that would be shadowed is placed above the one shadowing it", () => {
  const router = `const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => res.json([]));

router.get('/:id', async (req, res) => res.json({}));

module.exports = router;
`;

  const block = `router.get('/summary', async (req, res) => {
  res.json({ total: 0 });
});`;

  it("puts it before the route that would match first", () => {
    const next = buildContent(router, block).nextContent;
    const lines = next.split("\n");
    const summary = lines.findIndex((l) => l.includes("router.get('/summary'"));
    const byId = lines.findIndex((l) => l.includes("router.get('/:id'"));

    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(byId);
  });

  it("leaves the file parseable, which the placement must not cost", () => {
    expect(parseError("routes.js", buildContent(router, block).nextContent)).toBeNull();
  });

  it("does not disturb a route that nothing shadows", () => {
    const safe = `router.get('/:id/notes', async (req, res) => res.json([]));`;
    const next = buildContent(router, safe).nextContent;
    const lines = next.split("\n");
    // no reason to move it up, so it goes where new code goes
    expect(lines.findIndex((l) => l.includes("/:id/notes"))).toBeGreaterThan(
      lines.findIndex((l) => l.includes("router.get('/:id'"))
    );
  });

  it("keeps the existing routes exactly as they were", () => {
    const next = buildContent(router, block).nextContent;
    expect(next).toContain("router.get('/', async (req, res) => res.json([]));");
    expect(next).toContain("router.get('/:id', async (req, res) => res.json({}));");
    expect(next).toContain("module.exports = router;");
  });
});
