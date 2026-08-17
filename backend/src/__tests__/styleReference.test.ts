import fs from "fs";
import os from "os";
import path from "path";
import { listSourceFiles } from "../services/fileReader";
import { pickStyleReferences,
  pickSchemaReferences,
} from "../services/styleReference";

const tempDirs: string[] = [];

afterAll(() => {
  tempDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-style-"));
  tempDirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

const ROUTER = `
const express = require("express");
const router = express.Router();
const { listUsers } = require("../controllers/users");

router.get("/", listUsers);
router.post("/", listUsers);

module.exports = router;
`;

const CONTROLLER = `
const { findUsers } = require("../services/users");

const listUsers = async (req, res) => {
  try {
    res.json(await findUsers());
  } catch (err) {
    res.status(500).json({ error: "server error" });
  }
};

module.exports = { listUsers };
`;

const SERVICE = `
const db = require("../db");

const findUsers = async () => {
  return db.user.findMany({ orderBy: { createdAt: "desc" } });
};

module.exports = { findUsers };
`;

// the picked file per layer, keyed for readable assertions
function pick(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of pickStyleReferences(dir).references) {
    out[r.layer] = path.relative(dir, r.path);
  }
  return out;
}

describe("pickStyleReferences", () => {
  it("finds one exemplar per layer", () => {
    const dir = project({
      "src/routes/users.js": ROUTER,
      "src/controllers/users.js": CONTROLLER,
      "src/services/users.js": SERVICE,
    });

    expect(pick(dir)).toEqual({
      router: "src/routes/users.js",
      controller: "src/controllers/users.js",
      service: "src/services/users.js",
    });
  });

  // half the projects to hand have no controller and no service. inventing one
  // teaches the generator a shape the project does not use.
  it("reports only the layers the project actually has", () => {
    const dir = project({ "routes/users.js": ROUTER, "db.js": "module.exports = {};" });
    const picked = pick(dir);

    expect(picked.router).toBe("routes/users.js");
    expect(picked.controller).toBeUndefined();
    expect(picked.service).toBeUndefined();
  });

  // a full stack repo has two services/ directories, and generating a backend
  // endpoint from the frontend's produced a router full of axios calls
  it("ignores the frontend's own services and api directories", () => {
    const dir = project({
      "server/routes/users.js": ROUTER,
      "server/services/users.js": SERVICE,
      "client/src/services/api.js": `
        import axios from "axios";
        export const getUsers = () => axios.get("/api/users");
      `,
    });

    expect(pick(dir).service).toBe("server/services/users.js");
  });

  // middleware takes (req, res, next) and used to score as a controller in
  // every project that had no controllers directory
  it("does not mistake middleware for a controller", () => {
    const dir = project({
      "routes/users.js": ROUTER,
      "middleware/auth.js": `
        const authenticate = (req, res, next) => {
          if (!req.headers.authorization) return res.status(401).json({ error: "no token" });
          next();
        };
        module.exports = { authenticate };
      `,
    });

    expect(pick(dir).controller).toBeUndefined();
  });

  // a loose script has no http in it either, which is not the same as being a
  // service layer
  it("does not treat a stray script as a service", () => {
    const dir = project({
      "routes/users.js": ROUTER,
      "debug_apply_flow.js": "const run = async () => { console.log('hi'); };\nrun();",
    });

    expect(pick(dir).service).toBeUndefined();
  });

  it("skips tests, which show how the project tests rather than how it routes", () => {
    const dir = project({
      "routes/users.js": ROUTER,
      "routes/users.test.js": ROUTER,
    });

    expect(pick(dir).router).toBe("routes/users.js");
  });

  // one file that both registers routes and handles them is one reference, not
  // the same text presented twice under different headings
  it("never hands the same file back for two layers", () => {
    const dir = project({
      "app.js": `${ROUTER}\n${CONTROLLER}`,
    });

    const refs = pickStyleReferences(dir).references;
    expect(new Set(refs.map((r) => r.path)).size).toBe(refs.length);
  });

  it("returns nothing for a folder with no javascript in it", () => {
    const dir = project({ "main.py": "print('hi')", "README.md": "# docs" });
    const { references, examined } = pickStyleReferences(dir);

    expect(references).toHaveLength(0);
    expect(examined).toBe(0);
  });

  it("truncates a very large exemplar rather than dropping it", () => {
    const dir = project({ "routes/users.js": ROUTER + "\n" + "// pad\n".repeat(4000) });
    const [router] = pickStyleReferences(dir).references;

    expect(router.layer).toBe("router");
    expect(router.content).toContain("file truncated for length");
    expect(router.content.length).toBeLessThan(13_000);
  });
});

// A project names its layers however it likes, and the rule is only useful if
// an unfamiliar name leaves a gap rather than filling it with the wrong file.
describe("pickStyleReferences across naming conventions", () => {
  const ROUTER_FILE = ROUTER;
  const HANDLER_FILE = CONTROLLER;
  const SERVICE_FILE = SERVICE;

  it("reads handlers/ as the controller layer", () => {
    const dir = project({
      "src/routes/users.js": ROUTER_FILE,
      "src/handlers/users.js": HANDLER_FILE,
    });
    expect(pick(dir).controller).toBe("src/handlers/users.js");
  });

  it("finds layers nested under api/v1", () => {
    const dir = project({
      "src/api/v1/routes/users.js": ROUTER_FILE,
      "src/api/v1/controllers/users.js": HANDLER_FILE,
      "src/api/v1/services/users.js": SERVICE_FILE,
    });
    expect(pick(dir)).toEqual({
      router: "src/api/v1/routes/users.js",
      controller: "src/api/v1/controllers/users.js",
      service: "src/api/v1/services/users.js",
    });
  });

  it("reads the nest style, where the layer is in the filename", () => {
    const dir = project({
      "src/users/users.controller.ts": HANDLER_FILE,
      "src/users/users.service.ts": SERVICE_FILE,
    });
    const picked = pick(dir);
    expect(picked.controller).toBe("src/users/users.controller.ts");
    expect(picked.service).toBe("src/users/users.service.ts");
  });

  it("recognises usecases/ as the service layer", () => {
    const dir = project({ "routes/users.js": ROUTER_FILE, "usecases/users.js": SERVICE_FILE });
    expect(pick(dir).service).toBe("usecases/users.js");
  });

  // The case the whole rule exists for. A router is still found, because
  // router.get() says what the file is wherever it sits; the other two are
  // left blank rather than filled with the nearest plausible file.
  it("leaves the named layers blank when a project invents its own names", () => {
    const dir = project({ "transport/users.js": ROUTER_FILE, "logic/users.js": SERVICE_FILE });
    const picked = pick(dir);

    expect(picked.router).toBe("transport/users.js");
    expect(picked.controller).toBeUndefined();
    expect(picked.service).toBeUndefined();
  });

  // separately from naming, a directory that is plainly the frontend is not
  // read at all, whatever its files are called
  it("skips a frontend tree even when it names its layers correctly", () => {
    const dir = project({
      "web/routes/users.js": ROUTER_FILE,
      "web/services/users.js": SERVICE_FILE,
    });

    expect(pickStyleReferences(dir).references).toHaveLength(0);
  });

  // compiled output is javascript, mentions Route and router, and is the last
  // thing a generator should imitate
  it("ignores a framework's build directory", () => {
    const dir = project({
      "app/services/mail.js": SERVICE_FILE,
      ".next/server/chunks/route_actions_bf96.js": SERVICE_FILE,
      "routes/users.js": ROUTER_FILE,
    });
    const picked = pick(dir);

    expect(picked.service).toBe("app/services/mail.js");
    expect(Object.values(picked).some((p) => p.includes(".next"))).toBe(false);
  });
});

// a next.js project has neither a routes/ directory nor a router.get() call in
// it, and used to yield no exemplar at all
describe("pickStyleReferences on file based routing", () => {
  const ROUTE_FILE = `
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
  const products = await prisma.product.findMany();
  return NextResponse.json(products);
}
`;

  it("treats a route file as the router layer", () => {
    const dir = project({
      "app/api/products/route.ts": ROUTE_FILE,
      "app/dashboard/page.tsx": "export default function Page() { return null; }",
    });

    expect(pick(dir).router).toBe("app/api/products/route.ts");
  });

  it("reads lib/ as the service layer, which is where these projects put it", () => {
    const dir = project({
      "app/api/products/route.ts": ROUTE_FILE,
      "lib/mail-service.ts": SERVICE,
    });

    expect(pick(dir).service).toBe("lib/mail-service.ts");
  });

  // lib/ is the weaker signal of the two, so a project with both keeps the one
  // that says what it is
  it("still prefers services/ when a project has both", () => {
    const dir = project({
      "routes/users.js": ROUTER,
      "services/users.js": SERVICE,
      "lib/helpers.js": SERVICE,
    });

    expect(pick(dir).service).toBe("services/users.js");
  });
});

// The generator was writing queries against a schema it had imagined. Given a
// router and a service but no data model, it answered GET /incidents/:id/notes
// with .populate('notes.author') on a project whose notes are separate
// documents — code that parses, applies, boots, and answers 500.
describe("pickSchemaReferences", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-schema-"));
    fs.mkdirSync(path.join(root, "src", "models"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "models", "Incident.js"),
      "const mongoose = require('mongoose');\nconst incidentSchema = new mongoose.Schema({ title: String });\nmodule.exports = mongoose.model('Incident', incidentSchema);"
    );
    fs.writeFileSync(
      path.join(root, "src", "models", "User.js"),
      "const mongoose = require('mongoose');\nconst userSchema = new mongoose.Schema({ email: String });\nmodule.exports = mongoose.model('User', userSchema);"
    );
    fs.writeFileSync(
      path.join(root, "src", "routes.js"),
      "const router = require('express').Router();\nrouter.get('/', (req, res) => res.json([]));"
    );
  });

  const files = () => listSourceFiles(root);

  it("finds the files that define a record", () => {
    const found = pickSchemaReferences(root, files(), "/api/incidents");
    expect(found.map((s) => path.basename(s.path)).sort()).toEqual(["Incident.js", "User.js"]);
  });

  it("puts the endpoint's own resource first", () => {
    // /api/incidents/:id/notes is about incidents, so Incident.js is the one
    // that has to fit
    const found = pickSchemaReferences(root, files(), "/api/incidents/:id/notes");
    expect(path.basename(found[0].path)).toBe("Incident.js");
  });

  it("does not mistake a router for a data model", () => {
    const found = pickSchemaReferences(root, files(), "/api/incidents");
    expect(found.some((s) => s.path.endsWith("routes.js"))).toBe(false);
  });

  it("carries the schema text, since that is the whole point", () => {
    const [first] = pickSchemaReferences(root, files(), "/api/incidents");
    expect(first.content).toContain("new mongoose.Schema");
  });

  it("says nothing for a project that declares no models", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-bare-"));
    fs.writeFileSync(path.join(bare, "index.js"), "console.log('hi');");
    expect(pickSchemaReferences(bare, listSourceFiles(bare), "/api/x")).toEqual([]);
  });
});

// A PATCH /api/incidents/:id/commander was written into src/routes/auth.js.
// The picker chose whichever router scored highest across the project, the model
// was shown only that file, and it wrote there. Code landing in an unrelated
// router is worse than a style mismatch: it can break routes that already work.
describe("picking the files an endpoint belongs in", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-belongs-"));
    fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });

    const router = (name: string) =>
      `const express = require('express');\nconst router = express.Router();\nrouter.get('/', (req, res) => res.json([]));\nrouter.post('/', (req, res) => res.status(201).json({}));\nmodule.exports = router;\n// ${name}`;
    const service = (name: string) =>
      `const list = async () => [];\nconst find = async (id) => ({ id });\nmodule.exports = { list, find };\n// ${name}`;

    fs.writeFileSync(path.join(root, "src", "routes", "auth.js"), router("auth"));
    fs.writeFileSync(path.join(root, "src", "routes", "incidents.js"), router("incidents"));
    fs.writeFileSync(path.join(root, "src", "services", "authService.js"), service("auth"));
    fs.writeFileSync(path.join(root, "src", "services", "incidentService.js"), service("incident"));

    // the entry point wires up the real files
    fs.writeFileSync(
      path.join(root, "src", "index.js"),
      "require('./routes/auth');\nrequire('./routes/incidents');\nrequire('./services/authService');\nrequire('./services/incidentService');"
    );
  });

  const chosen = (forPath: string) =>
    pickStyleReferences(root, forPath)
      .references.map((r) => path.basename(r.path))
      .sort();

  it("writes an incidents endpoint against the incidents files", () => {
    expect(chosen("/api/incidents/:id/commander")).toEqual(["incidentService.js", "incidents.js"]);
  });

  it("writes an auth endpoint against the auth files", () => {
    expect(chosen("/api/auth/logout")).toEqual(["auth.js", "authService.js"]);
  });

  it("still picks something when the endpoint names no resource it has", () => {
    expect(pickStyleReferences(root, "/api/widgets").references.length).toBeGreaterThan(0);
  });

  it("passes over a file nothing imports, even when the name matches", () => {
    // a path bug once left a dead services/incidents.js beside the real
    // incidentService.js; being smaller, it scored better and got written into
    fs.writeFileSync(
      path.join(root, "src", "services", "incidents.js"),
      "const list = async () => [];\nmodule.exports = { list };"
    );
    expect(chosen("/api/incidents/:id/commander")).toEqual(["incidentService.js", "incidents.js"]);
  });
});
