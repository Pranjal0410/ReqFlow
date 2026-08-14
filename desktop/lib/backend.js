const http = require("http");
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

function pingHealth(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(deadline, isDead) {
  while (Date.now() < deadline) {
    if (await pingHealth()) return true;
    // a child that has already exited will never answer, and waiting the full
    // twenty seconds to say so hides the error that actually happened
    if (isDead && isDead()) return false;
    await wait(POLL_INTERVAL_MS);
  }
  return false;
}

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

  async _start({ entry, cwd, apiKey }) {
    if (await pingHealth()) {
      this.adopted = true;
      return { adopted: true };
    }

    this.child = fork(entry, [], {
      cwd,
      env: {
        ...process.env,
        // Electron's binary is node too, but only when told. Without this the
        // child would boot a second copy of the app instead of the server.
        ELECTRON_RUN_AS_NODE: "1",
        ...(apiKey ? { GEMINI_API_KEY: apiKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    const record = (chunk) => {
      const text = String(chunk);
      this.output.push(text);
      if (this.output.length > 200) this.output.shift();
      process.stdout.write(`[backend] ${text}`);
    };
    this.child.stdout?.on("data", record);
    this.child.stderr?.on("data", record);

    let exited = false;
    this.child.on("exit", (code) => {
      exited = true;
      if (code) this.output.push(`\nbackend exited with code ${code}\n`);
    });

    const ready = await waitForHealth(Date.now() + READY_TIMEOUT_MS, () => exited);
    if (!ready) {
      this.stop();
      throw new Error(this.lastOutput || `the backend did not answer on port ${PORT}`);
    }

    return { adopted: false };
  }

  // Closing the window must not leave a server behind holding port 4000, which
  // is what makes the next launch fail. Anything we adopted is left alone.
  async stop() {
    // a quit that arrives mid-launch waits for the launch to finish, so there
    // is something to kill rather than nothing to find
    if (this.starting) await this.starting.catch(() => {});

    const child = this.child;
    this.child = null;
    if (!child || child.killed || this.adopted) return;

    child.kill("SIGTERM");
    const stopped = await Promise.race([
      new Promise((resolve) => child.on("exit", () => resolve(true))),
      wait(SHUTDOWN_GRACE_MS).then(() => false),
    ]);
    if (!stopped) child.kill("SIGKILL");
  }
}

module.exports = { Backend, PORT, pingHealth };
