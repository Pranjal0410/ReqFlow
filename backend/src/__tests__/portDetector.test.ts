import fs from "fs";
import os from "os";
import path from "path";
import { detectPort } from "../services/portDetector";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-port-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

// the box has to be filled in for the user to confirm, so a guess that cannot
// be traced back to a file is worse than no guess
describe("detectPort", () => {
  it("prefers an env file, and says which one", () => {
    const dir = project({ ".env": "NODE_ENV=dev\nPORT=3001\n" });
    expect(detectPort(dir, [])).toEqual({ port: 3001, source: ".env" });
  });

  it("falls back to a port written into a package script", () => {
    const dir = project({
      "package.json": JSON.stringify({ scripts: { server1: "PORT=4200 nodemon src/index.js" } }),
    });
    expect(detectPort(dir, [])).toEqual({ port: 4200, source: "package.json, server1 script" });
  });

  it("falls back to the number in the source", () => {
    const dir = project({});
    const files = [{ path: "/x/src/index.js", content: "app.listen(8080, () => {})" }];
    expect(detectPort(dir, files)).toEqual({ port: 8080, source: "index.js" });
  });

  it("reads a PORT || fallback", () => {
    const dir = project({});
    const files = [{ path: "/x/server.js", content: "const p = process.env.PORT || 5000;" }];
    expect(detectPort(dir, files)?.port).toBe(5000);
  });

  it("ignores numbers that are not ports", () => {
    const dir = project({});
    const files = [{ path: "/x/a.js", content: "app.listen(7)" }];
    expect(detectPort(dir, files)).toBeNull();
  });

  it("survives a package.json that will not parse", () => {
    const dir = project({ "package.json": "{ not json" });
    expect(detectPort(dir, [])).toBeNull();
  });

  it("returns nothing rather than guessing when the project says nothing", () => {
    expect(detectPort(project({}), [])).toBeNull();
  });
});

// next, vite and nest all take the port as a flag rather than as an env var,
// and a framework that picks its own says nothing anywhere
describe("detectPort, framework projects", () => {
  it("reads a port out of a --port flag in a script", () => {
    const dir = project({
      "package.json": JSON.stringify({ scripts: { dev: "next dev -p 3001" } }),
    });
    expect(detectPort(dir, [])).toEqual({
      port: 3001,
      source: "package.json, dev script",
    });
  });

  it("reads the long form too", () => {
    const dir = project({
      "package.json": JSON.stringify({ scripts: { start: "nest start --port 4200" } }),
    });
    expect(detectPort(dir, [])?.port).toBe(4200);
  });

  // stated as the default it is, not passed off as something found in the code
  it("falls back to the framework's default and says so", () => {
    const dir = project({
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    });
    expect(detectPort(dir, [])).toEqual({ port: 3000, source: "next's default" });
  });

  it("prefers something the project actually wrote over the default", () => {
    const dir = project({
      ".env": "PORT=4500",
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    });
    expect(detectPort(dir, [])).toEqual({ port: 4500, source: ".env" });
  });
});
