import fs from "fs";
import os from "os";
import path from "path";
import { readProjectFiles } from "../services/fileReader";

const tempDirs: string[] = [];

afterAll(() => {
  tempDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-reader-"));
  tempDirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

const ROUTE_CODE = `
  const router = require("express").Router();
  router.get("/x", (req, res) => res.json({}));
`;

describe("readProjectFiles", () => {
  it("skips node_modules and .git", () => {
    const dir = project({
      "server.js": ROUTE_CODE,
      "node_modules/some-lib/index.js": ROUTE_CODE,
      "node_modules/nested/deep/router.js": ROUTE_CODE,
      ".git/hooks/pre-commit.js": ROUTE_CODE,
      "dist/bundle.js": ROUTE_CODE,
      "build/out.js": ROUTE_CODE,
    });

    const files = readProjectFiles(dir);
    const names = files.map((f) => f.path);

    expect(names).toHaveLength(1);
    expect(names[0]).toContain("server.js");
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => n.includes(".git"))).toBe(false);
    expect(names.some((n) => n.includes("dist"))).toBe(false);
    expect(names.some((n) => n.includes("build"))).toBe(false);
  });

  it("reads js, ts, jsx and tsx and ignores everything else", () => {
    const dir = project({
      "a.js": ROUTE_CODE,
      "b.ts": ROUTE_CODE,
      "c.jsx": ROUTE_CODE,
      "d.tsx": ROUTE_CODE,
      "e.py": ROUTE_CODE,
      "f.json": '{"router": "not code"}',
      "g.md": "router.get in a doc",
      "h.txt": ROUTE_CODE,
    });

    const exts = readProjectFiles(dir)
      .map((f) => path.extname(f.path))
      .sort();

    expect(exts).toEqual([".js", ".jsx", ".ts", ".tsx"]);
  });

  it("keeps only files that actually look like they define routes", () => {
    const dir = project({
      "routes.js": ROUTE_CODE,
      "helpers.js": "function add(a, b) { return a + b; }\nmodule.exports = add;",
    });

    const files = readProjectFiles(dir);

    expect(files).toHaveLength(1);
    expect(files[0].path).toContain("routes.js");
    expect(files[0].content).toContain("router.get");
  });

  it("walks nested folders", () => {
    const dir = project({
      "src/api/v1/users.js": ROUTE_CODE,
      "src/api/v2/orders.ts": ROUTE_CODE,
    });

    expect(readProjectFiles(dir)).toHaveLength(2);
  });

  it("throws a readable error when the path does not exist", () => {
    expect(() => readProjectFiles("/definitely/not/a/real/path")).toThrow(
      /path not found/i
    );
  });
});

// a scan used to die on the first dangling symlink it met, reporting the raw
// errno to the user, because statSync follows the link
describe("readProjectFiles resilience", () => {
  it("walks past a symlink whose target is gone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-broken-"));
    fs.writeFileSync(
      path.join(dir, "server.js"),
      'const express = require("express"); app.get("/users", () => {});'
    );
    fs.symlinkSync(path.join(dir, "does-not-exist"), path.join(dir, "dangling"));

    const files = readProjectFiles(dir);

    expect(files).toHaveLength(1);
    expect(files[0].path).toMatch(/server\.js$/);
  });
});
