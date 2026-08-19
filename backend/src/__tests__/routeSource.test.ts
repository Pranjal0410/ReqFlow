import fs from "fs";
import os from "os";
import path from "path";
import { findRouteSource, tailMatches, blockAt } from "../services/routeSource";

// A generated endpoint arrives with its code attached. A scanned one does not —
// the scan reports a method and a path, and the code that serves it is somewhere
// in the project. Finding it is what lets the same panel open for both.
describe("tailMatches", () => {
  it("matches a router mounted under a prefix", () => {
    // routes/users.js registers /:id/role for what the sidebar calls
    // /api/users/:id/role
    expect(tailMatches("/api/users/:id/role", "/:id/role")).toBe(true);
  });

  it("matches a root registration", () => {
    expect(tailMatches("/api/users", "/")).toBe(true);
  });

  it("treats one parameter as any parameter, since names differ", () => {
    expect(tailMatches("/api/users/:id", "/:userId")).toBe(true);
  });

  it("refuses a tail that is not this endpoint's", () => {
    expect(tailMatches("/api/users/:id/role", "/:id/status")).toBe(false);
    expect(tailMatches("/api/users", "/:id")).toBe(false);
  });

  it("refuses a registration longer than the path itself", () => {
    expect(tailMatches("/api/users", "/a/b/c/d")).toBe(false);
  });
});

describe("blockAt", () => {
  const lines = [
    "const x = 1;",
    "/**",
    " * does a thing",
    " */",
    "router.get('/', (req, res) => {",
    "  res.json([]);",
    "});",
    "const y = 2;",
  ];

  it("takes the whole handler and stops", () => {
    const block = blockAt(lines, 4);
    expect(block).toContain("res.json([]);");
    expect(block).not.toContain("const y = 2;");
  });

  it("brings the doc comment with it, which is what a reader wants", () => {
    expect(blockAt(lines, 4)).toContain("does a thing");
  });

  it("shows a window rather than the rest of the file when braces never close", () => {
    const broken = ["router.get('/', (req, res) => {", "  if (true) {"];
    expect(blockAt(broken, 0)).toContain("router.get");
  });
});

describe("findRouteSource", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-src-"));
    fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "routes", "users.js"),
      `const router = require('express').Router();

/**
 * Change a user's role
 */
router.patch('/:id/role', async (req, res) => {
  res.json({ role: req.body.role });
});

router.get('/', async (req, res) => {
  res.json([]);
});

module.exports = router;
`
    );
    fs.writeFileSync(
      path.join(root, "src", "routes", "incidents.js"),
      `const router = require('express').Router();
router.patch('/:id/role', async (req, res) => {
  res.json({ wrong: true });
});
module.exports = router;
`
    );
  });

  it("finds the handler behind a scanned endpoint", () => {
    const found = findRouteSource(root, "PATCH", "/api/users/:id/role")!;
    expect(found.file).toBe("src/routes/users.js");
    expect(found.code).toContain("res.json({ role: req.body.role });");
  });

  it("brings back where it is, so the claim is checkable", () => {
    const found = findRouteSource(root, "PATCH", "/api/users/:id/role")!;
    expect(found.line).toBe(6);
  });

  it("picks the file the endpoint belongs to when two register the same tail", () => {
    // incidents.js registers /:id/role too; users.js is the users endpoint
    const found = findRouteSource(root, "PATCH", "/api/users/:id/role")!;
    expect(found.file).not.toContain("incidents");
  });

  it("does not confuse one method for another", () => {
    expect(findRouteSource(root, "POST", "/api/users/:id/role")).toBeNull();
  });

  it("says so plainly when the code is not there to find", () => {
    expect(findRouteSource(root, "GET", "/api/nothing/here")).toBeNull();
  });
});
