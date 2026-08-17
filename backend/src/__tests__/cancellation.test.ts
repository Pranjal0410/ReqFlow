import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import request from "supertest";
import {
  beginRun,
  cancelRun,
  endRun,
  throwIfCancelled,
  isCancellation,
  Cancelled,
} from "../services/cancellation";
import { waitForServer } from "../services/readiness";
import { stopAll, runningProjects } from "../services/projectRunner";

// Cancelling is easy to offer and easy to get wrong. The thing being tested here
// is not that the button works, it is that stopping never leaves a project half
// written or a process nobody can see.

jest.setTimeout(60000);

describe("the run registry", () => {
  it("hands out a signal that the cancel flips", () => {
    const signal = beginRun("run-1")!;
    expect(signal.aborted).toBe(false);

    expect(cancelRun("run-1")).toBe(true);
    expect(signal.aborted).toBe(true);
    endRun("run-1");
  });

  // the run finished on its own, which is the same outcome the developer wanted
  it("reports cancelling a run that is already over as no-op", () => {
    expect(cancelRun("never-existed")).toBe(false);

    beginRun("run-2");
    endRun("run-2");
    expect(cancelRun("run-2")).toBe(false);
  });

  it("does not let an old cancel land on a new run of the same name", () => {
    const first = beginRun("run-3")!;
    cancelRun("run-3");
    expect(first.aborted).toBe(true);

    const second = beginRun("run-3")!;
    expect(second.aborted).toBe(false);
    endRun("run-3");
  });

  it("gives nothing to track when there is no run id", () => {
    expect(beginRun(undefined)).toBeUndefined();
  });

  it("throws something a caller cannot forget to check", () => {
    const signal = beginRun("run-4")!;
    expect(() => throwIfCancelled(signal)).not.toThrow();

    cancelRun("run-4");
    expect(() => throwIfCancelled(signal)).toThrow(Cancelled);

    try {
      throwIfCancelled(signal);
    } catch (err) {
      expect(isCancellation(err)).toBe(true);
    }
    endRun("run-4");
  });
});

describe("waiting for a server", () => {
  // the longest thing the app does, and the safest place to stop: nothing has
  // been written since it started
  it("gives up promptly when the run is cancelled", async () => {
    const signal = beginRun("wait-1")!;
    const started = Date.now();

    const waiting = waitForServer("http://127.0.0.1:9", 20_000, signal);
    setTimeout(() => cancelRun("wait-1"), 800);

    const outcome = await waiting;
    expect(outcome.up).toBe(false);
    // it stopped because it was told to, not because it ran out the 20s clock
    expect(Date.now() - started).toBeLessThan(5000);
    endRun("wait-1");
  });
});

describe("cancelling a verification", () => {
  const app = express();
  app.use(express.json());

  beforeAll(() => {
    const generateRouter = require("../routes/generate").default;
    app.use("/api/generate", generateRouter);
  });

  afterEach(async () => stopAll());

  // the files are already written by then, and they stay written. what stops is
  // the checking — and saying the change was undone would be a lie.
  it("leaves the applied files alone and says so", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cancel-"));
    const file = path.join(dir, "written.js");
    fs.writeFileSync(file, "// applied before the verification began\n");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "p", private: true, scripts: { dev: "node nothing.js" } })
    );

    const runId = "verify-cancel-1";
    // nothing is listening on this port, so the route sits in its wait
    const pending = request(app)
      .post("/api/generate/verify")
      .send({
        baseUrl: "http://127.0.0.1:9",
        method: "GET",
        path: "/",
        headers: {},
        body: null,
        verify: null,
        serverWasUp: false,
        projectPath: dir,
        runId,
      });

    setTimeout(() => cancelRun(runId), 1500);
    const res = await pending;

    expect(res.body.cancelled).toBe(true);
    expect(res.body.message).toContain("nothing was undone");

    // the file that was applied is still exactly as it was
    expect(fs.readFileSync(file, "utf-8")).toBe("// applied before the verification began\n");

    // and no process was left behind that nobody can see
    expect(runningProjects()).toHaveLength(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("cancelling over http", () => {
  const app = express();
  app.use(express.json());

  beforeAll(() => {
    app.use("/api/generate", require("../routes/generate").default);
    app.use("/api/ai-chat", require("../routes/aiChat").default);
  });

  it("answers honestly for a run that is not there", async () => {
    for (const base of ["/api/generate", "/api/ai-chat"]) {
      const res = await request(app).post(`${base}/cancel/no-such-run`);
      expect(res.body.cancelled).toBe(false);
      expect(res.body.detail).toContain("already finished");
    }
  });

  it("cancels a run that is under way", async () => {
    beginRun("http-run");
    const res = await request(app).post("/api/generate/cancel/http-run");
    expect(res.body.cancelled).toBe(true);
    endRun("http-run");
  });
});

// A port nobody is listening on, used above, needs no server — but jest wants
// the http import used or it complains about an unused binding under some
// configurations.
void http;
