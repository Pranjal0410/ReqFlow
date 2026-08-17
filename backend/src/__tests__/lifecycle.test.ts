import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import request from "supertest";
import { stopAll, isOurs, runningProjects } from "../services/projectRunner";

// The three ways a server can be, end to end through the route the app calls.
//
// These exist because two of the three were only ever argued for. Paths 1 and 3
// were driven in a browser; path 2 — ReqFlow restarting a server it started —
// had unit tests and a single curl, and both times a number was quoted for it
// the number came from the test harness rather than from the app. So each one
// here is asserted against what the server actually serves afterwards, never
// against a message.

jest.setTimeout(90000);

import generateRouter from "../routes/generate";
import projectRouter from "../routes/project";

const app = express();
app.use(express.json());
app.use("/api/generate", generateRouter);
app.use("/api/project", projectRouter);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
  });
}

// A project whose one route answers with whatever `says` was when it booted, so
// "did it reload" is a question about the running process rather than the file.
function project(port: number, says: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "p", private: true, scripts: { dev: "node server.js" } }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "server.js"), server(port, says));
  return dir;
}

const server = (port: number, says: string) => `
const http = require('http');
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ says: ${JSON.stringify(says)} }));
}).listen(${port});
`;

function ask(port: number): Promise<string | null> {
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

const verify = (projectPath: string, port: number) =>
  request(app)
    .post("/api/generate/verify")
    .send({
      baseUrl: `http://127.0.0.1:${port}`,
      method: "GET",
      path: "/",
      headers: {},
      body: null,
      verify: null,
      serverWasUp: false,
      projectPath,
    });

afterEach(async () => stopAll());

describe("path 1: nothing is running", () => {
  it("starts the project, verifies against it, and says it owns it", async () => {
    const port = await freePort();
    const dir = project(port, "started by reqflow");

    expect(await ask(port)).toBeNull();

    const res = await verify(dir, port);
    expect(res.body.ready).toBe(true);
    expect(res.body.ownership).toBe("started");
    expect(res.body.create.response.status).toBe(200);

    // the claim to own it has to be true, not just reported
    expect(isOurs(dir)).toBe(true);
    expect(runningProjects()).toHaveLength(1);
    expect(await ask(port)).toBe("started by reqflow");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stops only what it started, and the process really goes", async () => {
    const port = await freePort();
    const dir = project(port, "up");

    await verify(dir, port);
    expect(await ask(port)).toBe("up");

    const stopped = await request(app).post("/api/project/stop").send({ projectPath: dir });
    expect(stopped.body.stopped).toBe(true);
    expect(await ask(port)).toBeNull();
    expect(isOurs(dir)).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("path 2: ReqFlow already owns the server", () => {
  // The one that was never proven. What answers after a second verify has to be
  // the code on disk now, not the code that was there when it first booted.
  it("restarts its own server into the code that is on disk now", async () => {
    const port = await freePort();
    const dir = project(port, "before");

    const first = await verify(dir, port);
    expect(first.body.ownership).toBe("started");
    expect(await ask(port)).toBe("before");

    // the file changes, as an apply would change it
    fs.writeFileSync(path.join(dir, "server.js"), server(port, "after"));

    const second = await verify(dir, port);
    expect(second.body.ownership).toBe("restarted");
    expect(second.body.ready).toBe(true);

    // the assertion that matters: the running process is serving the new code
    expect(await ask(port)).toBe("after");
    expect(isOurs(dir)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("path 3: the developer's own server", () => {
  it("verifies against it and never touches it", async () => {
    const port = await freePort();
    const dir = project(port, "unused");

    // theirs, started outside ReqFlow
    const theirs = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ says: "theirs" }));
    });
    await new Promise<void>((r) => theirs.listen(port, "127.0.0.1", r));

    const res = await verify(dir, port);
    expect(res.body.ready).toBe(true);
    expect(res.body.ownership).toBe("existing");

    // still theirs, still running, and ReqFlow claims nothing
    expect(theirs.listening).toBe(true);
    expect(await ask(port)).toBe("theirs");
    expect(isOurs(dir)).toBe(false);
    expect(runningProjects()).toHaveLength(0);

    // and stop has nothing of ours to stop rather than reaching for theirs
    const stopped = await request(app).post("/api/project/stop").send({ projectPath: dir });
    expect(stopped.body.stopped).toBe(false);
    expect(theirs.listening).toBe(true);

    theirs.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
