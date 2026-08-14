import fs from "fs";
import os from "os";
import path from "path";
import {
  readProjectFiles,
  readProjectFilesCapped,
  MAX_SCAN_FILES,
  MAX_SCAN_CHARS,
  expandHome,
} from "../services/fileReader";

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

// pointing at a home folder rather than a project turned up thousands of files,
// and concatenating those built an 800MB prompt
describe("readProjectFilesCapped", () => {
  it("passes a normal project through untouched", () => {
    const dir = project({
      "a.js": 'const express = require("express"); app.get("/a", () => {});',
      "b.js": 'const express = require("express"); app.get("/b", () => {});',
    });

    const out = readProjectFilesCapped(dir);
    expect(out.files).toHaveLength(2);
    expect(out.found).toBe(2);
    expect(out.truncated).toBe(false);
  });

  it("stops at the file cap and says how many there were", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_SCAN_FILES + 25; i++) {
      files[`r${i}.js`] = 'const express = require("express"); app.get("/x", () => {});';
    }

    const out = readProjectFilesCapped(project(files));
    expect(out.files).toHaveLength(MAX_SCAN_FILES);
    expect(out.found).toBe(MAX_SCAN_FILES + 25);
    expect(out.truncated).toBe(true);
  });

  it("stops on total size before the file count is reached", () => {
    // sized against the cap, so the test does not care what the constant is
    const each = Math.floor(MAX_SCAN_CHARS / 4);
    const big = 'const express = require("express"); app.get("/x", () => {});' + "x".repeat(each);
    const out = readProjectFilesCapped(
      project({ "a.js": big, "b.js": big, "c.js": big, "d.js": big, "e.js": big, "f.js": big })
    );

    expect(out.files.length).toBeLessThan(6);
    expect(out.truncated).toBe(true);
    const chars = out.files.reduce((n, f) => n + f.content.length, 0);
    expect(chars).toBeLessThanOrEqual(MAX_SCAN_CHARS);
  });

  it("skips one oversized file rather than giving up on the rest", () => {
    const huge =
      'const express = require("express"); app.get("/huge", () => {});' +
      "x".repeat(MAX_SCAN_CHARS + 1000);
    const small = 'const express = require("express"); app.get("/small", () => {});';

    const out = readProjectFilesCapped(project({ "a-huge.js": huge, "b-small.js": small }));

    expect(out.files).toHaveLength(1);
    expect(out.files[0].path).toMatch(/b-small\.js$/);
    expect(out.truncated).toBe(true);
  });
});

// "~/projects/api" is what gets typed, and only a shell expands it
describe("expandHome", () => {
  it("expands a leading tilde", () => {
    expect(expandHome("~/projects/api")).toBe(path.join(os.homedir(), "projects/api"));
    expect(expandHome("~")).toBe(os.homedir());
  });

  it("leaves an absolute path alone", () => {
    expect(expandHome("/Users/x/api")).toBe("/Users/x/api");
  });

  it("does not touch a tilde that is not the home shorthand", () => {
    expect(expandHome("/tmp/~backup")).toBe("/tmp/~backup");
    expect(expandHome("~user/api")).toBe("~user/api");
  });

  it("trims surrounding whitespace, which pasting adds", () => {
    expect(expandHome("  /Users/x/api  ")).toBe("/Users/x/api");
  });
});
