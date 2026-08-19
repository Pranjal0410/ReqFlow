const http = require("http");
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");

// The backend is the same Express server as always, unchanged, run as a child
// process. Nothing here is Electron-specific from its point of view: it reads
// GEMINI_API_KEY out of its environment and listens on 4000 exactly as it does
// under npm run dev.

const PORT = 4000;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

// how long to wait for it to answer before deciding something is wrong. a cold
// start is well under a second; this is generous enough to survive a laptop
// that has just woken up.
const READY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

// after asking it to stop, how long before insisting
const SHUTDOWN_GRACE_MS = 3000;

// Who is on port 4000. Two different questions are asked of this, and telling
// them apart is the whole point of having four answers rather than a boolean:
//
//   "free"      nothing is listening
//   "reqflow"   a health answer that names itself as ours
//   "stranger"  something answered, but not as ReqFlow
//   "silent"    something holds the socket and did not answer
//
// Whether to adopt a server we did not start needs "reqflow" and nothing less:
// adopting a stranger means every request the user makes goes somewhere they
// did not choose, and quietly. Whether a child we did start has finished
// booting is a different question, and there the name does not matter — we know
// whose server it is, we spawned it.
function inspectPort(timeoutMs = 1500) {
  return new Promise((resolve) => {
    // agent: false gives every probe its own connection. The pooled one is kept
    // alive between calls, and a pooled socket to a server that has since
    // stopped fails with a reset rather than a refusal — which read as "the
    // port is free" and sent the launch off to spawn a backend that could not
    // bind. It also means a probe leaves nothing connected behind it.
    const req = http.get(HEALTH_URL, { timeout: timeoutMs, agent: false }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve("stranger");
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        // a health endpoint does not answer with a megabyte, and whatever is
        // doing so is not the thing we are looking for
        if (body.length > 4096) req.destroy();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).app === "reqflow" ? "reqflow" : "stranger");
        } catch {
          resolve("stranger");
        }
      });
    });
    // Refusal is the one error that means nobody is there. Every other failure
    // — a reset, a hang-up mid-answer — means something is on the port and is
    // behaving in a way ReqFlow's server does not, so it is not assumed away.
    req.on("error", (err) => {
      resolve(err.code === "ECONNREFUSED" ? "free" : "silent");
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("silent");
    });
  });
}

// A server we did not start, answering as ours, is one we may adopt.
async function pingHealth(timeoutMs = 1000) {
  return (await inspectPort(timeoutMs)) === "reqflow";
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Is the child we spawned up yet? Any answer at all settles it, because on a
// port that was free a moment ago there is nothing else it could be. Asking for
// the name here instead cost twenty seconds and an error box the first time a
// shell met a backend built before the name existed — a version mismatch
// reported as a server that would not start.
async function waitForOwnBackend(deadline, isDead, mustNameItself) {
  while (Date.now() < deadline) {
    const holder = await inspectPort();
    // after the user chose to start anyway, a stranger is known to be on the
    // port, so only the name can tell the two apart
    if (mustNameItself ? holder === "reqflow" : holder === "reqflow" || holder === "stranger") {
      return true;
    }
    // a child that has already exited will never answer, and waiting the full
    // twenty seconds to say so hides the error that actually happened
    if (isDead && isDead()) return false;
    await wait(POLL_INTERVAL_MS);
  }
  return false;
}

// A backend that dies takes every request with it, and the window says only
// that port 4000 is not answering — which reads as "ReqFlow is broken" rather
// than "the server stopped and is coming back". Restarting is nearly always
// right, and nearly always invisible.
//
// The limit is what stops a backend that cannot run from being restarted for
// the rest of the afternoon. Counted over a window, so a server that has been
// up for hours and then falls over still gets its retries.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 500;

class Backend {
  constructor() {
    this.child = null;
    // start() is async, and a quit can arrive while it is still in flight —
    // closing the key prompt used to do exactly that. Without something to
    // wait on, stop() would run before the child existed, find nothing to
    // kill, and leave a server behind holding port 4000 with no window
    // attached to it.
    this.starting = null;
    // true when something was already listening on 4000 when we started. that
    // is almost always the developer's own npm run dev, and killing it on quit
    // would be taking down a server this app did not start.
    this.adopted = false;
    this.output = [];
    // what start() was given, so a restart can be the same launch again
    this.options = null;
    // set while stop() is running, so a child we killed on purpose is not
    // mistaken for one that crashed and restarted underneath the quit
    this.stopping = false;
    // when each unasked-for exit happened, oldest first
    this.crashes = [];
    this.log = null;
  }

  // the last thing it said before dying, which is the only useful part of a
  // "backend would not start" message
  get lastOutput() {
    return this.output.join("").trim().split("\n").slice(-8).join("\n");
  }

  start(options) {
    this.starting = this._start(options).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async _start(options) {
    const { onConflict } = options;
    this.options = options;
    const holder = await inspectPort();

    if (holder === "reqflow") {
      this.adopted = true;
      return { adopted: true };
    }

    // Someone else has the port. Spawning now would produce a server that
    // cannot listen and a "backend would not start" box naming the wrong cause,
    // so the caller is asked what to do while the fact is still known.
    const occupied = holder !== "free";
    if (occupied) {
      const proceed = onConflict ? await onConflict() : false;
      if (!proceed) {
        const err = new Error(
          `Port ${PORT} is held by something that is not ReqFlow's backend.`
        );
        err.code = "PORT_CONFLICT";
        throw err;
      }
      // Told to carry on anyway: the child will fail to bind and say so in its
      // own words, which is the honest thing to show at that point.
    }

    let exited = false;
    this._spawn(() => {
      exited = true;
    });

    const ready = await waitForOwnBackend(Date.now() + READY_TIMEOUT_MS, () => exited, occupied);
    if (!ready) {
      this.stop();
      throw new Error(this.lastOutput || `the backend did not answer on port ${PORT}`);
    }

    return { adopted: false };
  }

  // one launch of the child, wired up for output and for its own death. Called
  // again, unchanged, when the backend has to be brought back.
  _spawn(onExit) {
    const { entry, cwd, apiKey, modelPath, settingsFile } = this.options;

    const child = fork(entry, [], {
      cwd,
      env: {
        ...process.env,
        // Electron's binary is node too, but only when told. Without this the
        // child would boot a second copy of the app instead of the server.
        ELECTRON_RUN_AS_NODE: "1",
        ...(apiKey ? { GEMINI_API_KEY: apiKey } : {}),
        // Where Settings writes what the user changes. It is the same file
        // readApiKey() already looks in, so a key saved from the app is found on
        // the next launch — and sealExistingKey() moves it into the OS keychain
        // then, leaving no plain copy behind.
        ...(settingsFile ? { REQFLOW_SETTINGS_FILE: settingsFile } : {}),
        // A model file to load turns the backend's provider switch over. It is
        // passed rather than written to a config file, so a restart of the child
        // after a crash carries the same answer without re-reading anything.
        ...(modelPath ? { LLM_PROVIDER: "embedded", LOCAL_MODEL_PATH: modelPath } : {}),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child = child;

    // Files the backend was not allowed to write itself.
    //
    // On macOS the folder dialog grants access to this process, not to the
    // child it spawns — a signed app would pass that on, an ad-hoc signed one
    // does not. So the child asks, and this writes. It is the same bytes to the
    // same path either way; the only thing that changes is who the system
    // believes is doing it.
    child.on("message", (message) => {
      if (!message || message.type !== "reqflow:write") return;

      const reply = (ok, error) =>
        child.connected && child.send({ type: "reqflow:write-result", id: message.id, ok, error });

      try {
        for (const file of message.files || []) {
          // the child has already decided what to write and checked that it
          // parses; this is the write and nothing else
          fs.mkdirSync(path.dirname(file.path), { recursive: true });
          fs.writeFileSync(file.path, file.content, "utf-8");
        }
        reply(true);
      } catch (err) {
        reply(false, String(err?.message || err));
      }
    });

    const record = (chunk) => {
      const text = String(chunk);
      this.output.push(text);
      if (this.output.length > 200) this.output.shift();
      process.stdout.write(`[backend] ${text}`);
      this.log?.write(text);
    };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);

    child.on("exit", (code, signal) => {
      if (code) this.output.push(`\nbackend exited with code ${code}\n`);
      if (onExit) onExit(code, signal);
      // stop() kills the child on purpose, and a child replaced by a restart is
      // no longer the one we are watching
      if (this.stopping || this.child !== child) return;
      this._restart(code, signal);
    });

    return child;
  }

  // Brings the backend back after an exit nobody asked for. The window keeps
  // pointing at port 4000 throughout: to the page this is a handful of failed
  // requests, not a session that has to be started again.
  _restart(code, signal) {
    const now = Date.now();
    this.crashes = this.crashes.filter((at) => now - at < RESTART_WINDOW_MS);
    this.crashes.push(now);

    const how = signal ? `on ${signal}` : `with code ${code}`;

    if (this.crashes.length > MAX_RESTARTS) {
      const message =
        `The backend has stopped ${this.crashes.length} times in the last minute and is not being restarted again.\n\n` +
        (this.lastOutput || `It exited ${how}.`);
      console.error(`[desktop] backend gave up after ${this.crashes.length} restarts`);
      this.child = null;
      this.options?.onGiveUp?.(message);
      return;
    }

    console.error(`[desktop] the backend exited ${how}, restarting it`);
    this.log?.write(`\n[desktop] backend exited ${how}, restarting it\n`);
    this.child = null;

    setTimeout(() => {
      // a quit that arrived while we were waiting means there is nothing left
      // to restart into
      if (this.stopping) return;
      this._spawn();
    }, RESTART_DELAY_MS);
  }

  // Closing the window must not leave a server behind holding port 4000, which
  // is what makes the next launch fail. Anything we adopted is left alone.
  async stop() {
    // set before waiting on anything, so a child that dies during the quit is
    // not restarted into a shutdown that is already under way
    this.stopping = true;

    // a quit that arrives mid-launch waits for the launch to finish, so there
    // is something to kill rather than nothing to find
    if (this.starting) await this.starting.catch(() => {});

    const child = this.child;
    this.child = null;

    if (child && !child.killed && !this.adopted) {
      child.kill("SIGTERM");
      const stopped = await Promise.race([
        new Promise((resolve) => child.on("exit", () => resolve(true))),
        wait(SHUTDOWN_GRACE_MS).then(() => false),
      ]);
      if (!stopped) child.kill("SIGKILL");
    }

    await this._closeLog();
  }

  // Everything the backend said, kept where it can be read after the app has
  // been quit — which is the only place to look when it crashed, since its
  // console goes nowhere in a packaged app. Two files: this run and the one
  // before it, because the run worth reading is usually the one that just
  // ended badly.
  openLog(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const current = path.join(dir, "backend.log");
      if (fs.existsSync(current)) {
        fs.renameSync(current, path.join(dir, "backend.previous.log"));
      }
      this.log = fs.createWriteStream(current, { flags: "a" });
      // a crash is read against what the app was doing at the time, and
      // without this there is no way to tell one run's lines from another's
      this.log.write(`\n=== ReqFlow started ${new Date().toISOString()} ===\n`);
      return current;
    } catch (err) {
      // logging is not worth failing a launch over
      console.error(`[desktop] could not open the backend log: ${err.message}`);
      this.log = null;
      return null;
    }
  }

  _closeLog() {
    const log = this.log;
    this.log = null;
    if (!log) return Promise.resolve();
    return new Promise((done) => log.end(done));
  }
}

module.exports = { Backend, PORT, pingHealth, inspectPort };
