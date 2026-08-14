import fs from "fs";
import os from "os";
import path from "path";
import { pickStyleReferences } from "../services/styleReference";

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
