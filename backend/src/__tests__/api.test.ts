import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import express from "express";
import cors from "cors";
import type { Server } from "http";

// the analyze route calls Gemini. mocking it keeps the suite deterministic,
// free and offline. the real prompt is not what these tests are checking.
jest.mock("../services/gemini", () => ({
  analyzeCode: jest.fn(async () => [
    {
      method: "GET",
      path: "/users",
      description: "lists users",
      params: [],
      body: null,
    },
    {
      method: "POST",
      path: "/users",
      description: "creates a user",
      params: [],
      body: { name: "string" },
    },
  ]),
}));

import proxyRouter from "../routes/proxy";
import analyzeRouter from "../routes/analyze";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/analyze", analyzeRouter);
app.use("/api/proxy", proxyRouter);
app.get("/health", (req, res) => {
  res.json({ status: "running", timestamp: new Date().toISOString() });
});

// a throwaway upstream so the forwarding tests do not depend on the internet
let upstream: Server;
let upstreamUrl: string;
let closedPort: number;

beforeAll(async () => {
  const target = express();
  target.use(express.json());
  target.get("/thing", (req, res) => res.json({ name: "widget", id: 7 }));
  target.post("/echo", (req, res) => res.status(201).json({ received: req.body }));
  // a local server that bounces the caller somewhere else. the first is the
  // relay the target guard exists to stop, the second must keep working.
  target.get("/redirect-out", (req, res) => res.redirect(302, "http://example.com/"));
  target.get("/redirect-in", (req, res) => res.redirect(302, `${upstreamUrl}/thing`));
  target.get("/traced", (req, res) => {
    res.set(
      "Server-Timing",
      'controller;dur=15, service;dur=32, db;dur=18;desc="INSERT INTO users"'
    );
    res.json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    upstream = target.listen(0, () => resolve());
  });
  const addr = upstream.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  upstreamUrl = `http://127.0.0.1:${port}`;

  // grab a port then release it, so nothing is listening on it
  const spare = express().listen(0);
  const spareAddr = spare.address();
  closedPort = typeof spareAddr === "object" && spareAddr ? spareAddr.port : 65000;
  await new Promise<void>((resolve) => spare.close(() => resolve()));
});

afterAll(async () => {
  if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

// ---------------------------------------------------------------- fixtures

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-test-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

const tempDirs: string[] = [];
afterAll(() => {
  tempDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

function project(files: Record<string, string>) {
  const dir = makeProject(files);
  tempDirs.push(dir);
  return dir;
}

// ------------------------------------------------------------------ health

describe("GET /health", () => {
  it("returns running status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
    expect(res.body.timestamp).toEqual(expect.any(String));
  });
});

// ------------------------------------------------------------------- proxy

describe("POST /api/proxy", () => {
  it("returns 400 when method is missing", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ url: "http://example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app).post("/api/proxy").send({ method: "GET" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("refuses a redirect that would leave the private network", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/redirect-out` });

    // the guard only ever saw a local url, so the hop is where it has to bite
    expect(res.body.status).toBe(0);
    expect(JSON.stringify(res.body.data)).toMatch(/only local and private/i);
    expect(JSON.stringify(res.body.data)).toMatch(/example\.com/);
  });

  it("still follows a redirect that stays local", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/redirect-in` });

    expect(res.body.status).toBe(200);
    expect(res.body.data).toEqual({ name: "widget", id: 7 });
  });

  it("forwards a GET request and reports timing", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/thing` });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(200);
    expect(res.body.data).toEqual({ name: "widget", id: 7 });
    expect(res.body.timing.total).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.timing.total).toBe("number");
  });

  it("forwards a POST request with a body", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({
        method: "POST",
        url: `${upstreamUrl}/echo`,
        headers: { "Content-Type": "application/json" },
        body: { title: "outage", severity: "critical" },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(201);
    expect(res.body.data.received).toEqual({
      title: "outage",
      severity: "critical",
    });
  });

  it("passes 4xx from upstream through instead of throwing", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/missing` });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(404);
  });

  it("refuses a public target with 403", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: "https://example.com" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/local and private/i);
  });

  it("still allows loopback targets", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/thing` });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(200);
  });

  it("reports measured ttfb and download separately", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/thing` });

    const t = res.body.timing;
    expect(t.ttfb).toBeGreaterThanOrEqual(0);
    expect(t.download).toBeGreaterThanOrEqual(0);
    // the parts add up to the whole rather than being a fixed ratio of it
    expect(t.ttfb + t.download).toBe(t.total);
  });

  it("reports response size and where the number came from", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/thing` });

    expect(res.body.size).toBeGreaterThan(0);
    expect(["content-length", "measured"]).toContain(res.body.sizeSource);
    expect(res.body.size).toBe(
      Buffer.byteLength(JSON.stringify({ name: "widget", id: 7 }))
    );
  });

  it("passes through the spans a server reports about itself", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/traced` });

    expect(res.body.serverTiming).toEqual([
      { name: "controller", description: null, duration: 15 },
      { name: "service", description: null, duration: 32 },
      { name: "db", description: "INSERT INTO users", duration: 18 },
    ]);
  });

  it("reports no spans for a server that sends no Server-Timing header", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/thing` });

    expect(res.body.serverTiming).toEqual([]);
  });

  it("handles an unreachable server without crashing", async () => {
    const res = await request(app)
      .post("/api/proxy")
      .send({ method: "GET", url: `http://127.0.0.1:${closedPort}/nope` });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(0);
    expect(res.body.data).toHaveProperty("error");
    expect(res.body.timing.total).toBeGreaterThanOrEqual(0);
  });
});

// ----------------------------------------------------------------- analyze

describe("POST /api/analyze", () => {
  it("returns 400 when projectPath is missing", async () => {
    const res = await request(app).post("/api/analyze").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectPath/i);
  });

  it("returns detected routes for a project that has them", async () => {
    const dir = project({
      "server.js": `
        const express = require("express");
        const app = express();
        app.get("/users", (req, res) => res.json([]));
        app.post("/users", (req, res) => res.status(201).json({}));
        module.exports = app;
      `,
    });

    const res = await request(app).post("/api/analyze").send({ projectPath: dir });

    expect(res.status).toBe(200);
    expect(res.body.filesScanned).toBe(1);
    expect(res.body.routes).toHaveLength(2);
    expect(res.body.routes[0]).toMatchObject({ method: "GET", path: "/users" });
  });

  it("returns 404 when the folder has no route files", async () => {
    // a purpose built folder, not /tmp, which on a dev machine is full of
    // other people's javascript and would make this pass or fail at random
    const dir = project({
      "readme.md": "no code here",
      "notes.txt": "app.get is mentioned but this is not javascript",
    });

    const res = await request(app).post("/api/analyze").send({ projectPath: dir });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no route files/i);
  });

  it("returns 500 with a readable message when the path does not exist", async () => {
    const res = await request(app)
      .post("/api/analyze")
      .send({ projectPath: "/definitely/not/a/real/path" });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/path not found/i);
  });

  it("serves a second scan of unchanged code from cache without calling Gemini", async () => {
    const { analyzeCode } = require("../services/gemini");
    const dir = project({
      "server.js": `const express = require("express"); app.get("/users", () => {});`,
    });

    const first = await request(app).post("/api/analyze").send({ projectPath: dir });
    const callsAfterFirst = (analyzeCode as jest.Mock).mock.calls.length;

    const second = await request(app).post("/api/analyze").send({ projectPath: dir });

    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(second.body.routes).toEqual(first.body.routes);
    expect((analyzeCode as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
  });

  it("re-analyses when the code changed, even inside the cache window", async () => {
    const { analyzeCode } = require("../services/gemini");
    const dir = project({
      "server.js": `const express = require("express"); app.get("/users", () => {});`,
    });

    await request(app).post("/api/analyze").send({ projectPath: dir });
    const callsAfterFirst = (analyzeCode as jest.Mock).mock.calls.length;

    fs.writeFileSync(
      path.join(dir, "server.js"),
      `const express = require("express"); app.get("/users", () => {}); app.get("/orders", () => {});`
    );

    const second = await request(app).post("/api/analyze").send({ projectPath: dir });

    expect(second.body.cached).toBe(false);
    expect((analyzeCode as jest.Mock).mock.calls.length).toBe(callsAfterFirst + 1);
  });
});

describe("POST /api/analyze/files", () => {
  it("counts route files without calling Gemini", async () => {
    const { analyzeCode } = require("../services/gemini");
    const dir = project({
      "server.js": `const express = require("express"); app.get("/users", () => {});`,
      "notes.txt": "not javascript",
    });

    const callsBefore = (analyzeCode as jest.Mock).mock.calls.length;
    const res = await request(app).post("/api/analyze/files").send({ projectPath: dir });

    expect(res.status).toBe(200);
    expect(res.body.filesScanned).toBe(1);
    expect((analyzeCode as jest.Mock).mock.calls.length).toBe(callsBefore);
  });

  it("returns 400 when projectPath is missing", async () => {
    const res = await request(app).post("/api/analyze/files").send({});
    expect(res.status).toBe(400);
  });
});
