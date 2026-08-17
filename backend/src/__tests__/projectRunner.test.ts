import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import {
  detectRunCommand,
  startProject,
  restartProject,
  stopProject,
  stopAll,
  isOurs,
  runningProjects,
} from "../services/projectRunner";

// Applying a change and finding out whether it worked has to be one action. That
// means ReqFlow reloads the project itself — and the line it must never cross is
// touching a server it did not start, which is somebody's own terminal.

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return dir;
}

const pkg = (scripts: Record<string, string>) =>
  JSON.stringify({ name: "p", private: true, scripts }, null, 2);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
  });
}

const server = (port: number, body: string) => `
const http = require('http');
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ says: ${JSON.stringify(body)} }));
}).listen(${port});
`;

async function ask(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 3000 }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw).says);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

describe("detectRunCommand", () => {
  // dev is the one with the watcher; start is often production and may not
  // reload at all
  it("prefers dev over start", () => {
    const dir = project({ "package.json": pkg({ start: "node s.js", dev: "nodemon s.js" }) });
    expect(detectRunCommand(dir)?.script).toBe("dev");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back through start and serve", () => {
    const a = project({ "package.json": pkg({ start: "node s.js" }) });
    expect(detectRunCommand(a)?.script).toBe("start");

    const b = project({ "package.json": pkg({ serve: "node s.js" }) });
    expect(detectRunCommand(b)?.script).toBe("serve");

    for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
  });

  // guessing at `node index.js` is how ReqFlow would run the wrong thing
  it("says nothing rather than guessing", () => {
    expect(detectRunCommand(project({ "package.json": pkg({ test: "jest" }) }))).toBeNull();
    expect(detectRunCommand(project({ "readme.md": "hello" }))).toBeNull();
  });
});

describe("running a project", () => {
  jest.setTimeout(45000);
  afterEach(async () => stopAll());

  it("starts it and waits until it answers", async () => {
    const port = await freePort();
    const dir = project({
      "package.json": pkg({ dev: "node server.js" }),
      "server.js": server(port, "first"),
    });

    const outcome = await startProject(dir, `http://127.0.0.1:${port}`);
    expect(outcome.started).toBe(true);
    expect(outcome.command).toBe("npm run dev");
    expect(await ask(port)).toBe("first");

    await stopProject(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // the whole point: what answers after a restart is the code on disk now, not
  // the code that was there when the server started
  it("restarts into the code that is on disk now", async () => {
    const port = await freePort();
    const dir = project({
      "package.json": pkg({ dev: "node server.js" }),
      "server.js": server(port, "before"),
    });

    await startProject(dir, `http://127.0.0.1:${port}`);
    expect(await ask(port)).toBe("before");

    fs.writeFileSync(path.join(dir, "server.js"), server(port, "after"));
    const restarted = await restartProject(dir, `http://127.0.0.1:${port}`);

    expect(restarted.started).toBe(true);
    expect(await ask(port)).toBe("after");

    await stopProject(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // npm sits between us and the server; killing only the wrapper leaves the
  // server holding the port with nothing watching it
  it("takes the server down with the script that started it", async () => {
    const port = await freePort();
    const dir = project({
      "package.json": pkg({ dev: "node server.js" }),
      "server.js": server(port, "up"),
    });

    await startProject(dir, `http://127.0.0.1:${port}`);
    await stopProject(dir);

    expect(await ask(port)).toBeNull();
    expect(isOurs(dir)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // the line that must not be crossed: a server in someone's own terminal
  it("refuses to touch a server it did not start", async () => {
    const port = await freePort();
    const theirs = http.createServer((_req, res) => res.end("{}"));
    await new Promise<void>((r) => theirs.listen(port, "127.0.0.1", r));

    const dir = project({
      "package.json": pkg({ dev: "node server.js" }),
      "server.js": server(port, "ours"),
    });

    const outcome = await startProject(dir, `http://127.0.0.1:${port}`);
    expect(outcome.started).toBe(false);
    expect(outcome.detail).toContain("not ReqFlow's to restart");

    const refused = await restartProject(dir, `http://127.0.0.1:${port}`);
    expect(refused.started).toBe(false);

    // still theirs, still running
    expect(theirs.listening).toBe(true);
    theirs.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("explains itself in the project's own words when it will not start", async () => {
    const port = await freePort();
    const dir = project({
      "package.json": pkg({ dev: "node server.js" }),
      "server.js": "throw new Error('the project is broken');",
    });

    const outcome = await startProject(dir, `http://127.0.0.1:${port}`);
    expect(outcome.started).toBe(false);
    expect(outcome.detail).toContain("the project is broken");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// The same project reached by two names is one project. On macOS /var is a link
// to /private/var, so keying on the spelling would let ReqFlow start a second
// server for a project it is already running, and then find neither to stop.
describe("project identity", () => {
  jest.setTimeout(45000);
  afterEach(async () => stopAll());

  it("treats a symlinked path and its real path as the same project", async () => {
    const port = await freePort();
    const real = project({
      "package.json": pkg({ dev: "node server.js" }),
      "server.js": server(port, "one"),
    });

    const link = path.join(os.tmpdir(), `link-${Date.now()}`);
    fs.symlinkSync(real, link, "dir");

    await startProject(link, `http://127.0.0.1:${port}`);

    // started through the link, recognised through the real path and vice versa
    expect(isOurs(real)).toBe(true);
    expect(isOurs(link)).toBe(true);
    expect(runningProjects()).toHaveLength(1);

    await stopProject(real);
    expect(isOurs(link)).toBe(false);

    fs.rmSync(link, { force: true });
    fs.rmSync(real, { recursive: true, force: true });
  });
});
