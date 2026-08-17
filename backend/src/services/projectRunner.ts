import fs from "fs";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { expandHome } from "./fileReader";
import { waitForServer, READY_TIMEOUT_MS } from "./readiness";

// Running the developer's project, so that applying a change and finding out
// whether it worked is one action rather than three.
//
// Until this, ReqFlow wrote the code and then hoped: a project under nodemon
// picked it up, and a project started with plain `node server.js` did not, so
// the endpoint 404'd against a server still running the code from before. The
// developer then had to notice, restart, and send the request themselves — which
// is exactly the work this feature exists to remove.
//
// The rule is the one the desktop wrapper already follows for its own backend:
// only ever manage a process you started. A server someone has running in their
// own terminal is theirs. Killing it to make our verification tidy would be
// taking down something we did not put up, possibly mid-request, and no result
// is worth that.

export interface RunCommand {
  // the npm script to run, e.g. "dev"
  script: string;
  // what it will actually execute, shown to the developer before it does
  command: string;
}

// In the order a project means them. `dev` is the one with the watcher, which is
// why it comes first; `start` is usually production and may not reload at all.
const SCRIPT_PREFERENCE = ["dev", "start", "serve", "server"];

export function detectRunCommand(rawPath: string): RunCommand | null {
  try {
    const body = fs.readFileSync(path.join(expandHome(rawPath), "package.json"), "utf-8");
    const scripts = JSON.parse(body).scripts || {};

    for (const name of SCRIPT_PREFERENCE) {
      if (typeof scripts[name] === "string" && scripts[name].trim()) {
        return { script: name, command: `npm run ${name}` };
      }
    }
  } catch {
    // no package.json, or one that will not parse. there is nothing to run and
    // saying so is better than guessing at `node index.js`
  }
  return null;
}

interface Running {
  child: ChildProcess;
  command: RunCommand;
  // kept so a failure to start can be explained in the project's own words
  output: string[];
  // set while stopping, so a child killed on purpose is not read as a crash
  stopping: boolean;
  since: number;
}

// What ReqFlow is running, for the app to show. A process this app started and
// the developer can neither see nor stop is not a convenience, it is something
// taken from them: they close the window and their machine is still running a
// server they never started and cannot find.
export interface RunningProject {
  projectPath: string;
  command: string;
  pid: number | null;
  since: number;
}

export function runningProjects(): RunningProject[] {
  const out: RunningProject[] = [];
  for (const [projectPath, held] of running) {
    if (held.child.exitCode !== null) continue;
    out.push({
      projectPath,
      command: held.command.command,
      pid: held.child.pid ?? null,
      since: held.since,
    });
  }
  return out;
}

const running = new Map<string, Running>();

// Symlinks resolved, because the same project reached by two names must be one
// project. On macOS /var is a link to /private/var, so a path typed one way and
// a path reported another way are the same directory — and keying on the spelling
// would let ReqFlow start a second server for a project it is already running,
// then fail to find either of them to stop.
function key(rawPath: string): string {
  const resolved = path.resolve(expandHome(rawPath));
  try {
    return fs.realpathSync(resolved);
  } catch {
    // not there yet, or not readable. the resolved spelling is the best there is,
    // and the caller's own error will be the useful one
    return resolved;
  }
}

export function isOurs(projectPath: string): boolean {
  const held = running.get(key(projectPath));
  return !!held && held.child.exitCode === null;
}

// What the project said about why it will not start. The last few lines of a
// crash are the bottom of a stack trace — node internals, module loaders — and
// the line that names the fault is above them. Leading with the tail hands the
// developer the least useful part of what their own project just told them.
export function lastOutput(projectPath: string): string {
  const held = running.get(key(projectPath));
  if (!held) return "";

  const lines = held.output.join("").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const named = lines.find((l) => /^[A-Za-z]*Error\b|Cannot find|is not defined|EADDRINUSE/.test(l));

  if (named) return named.slice(0, 200);

  // nothing recognisable, so the tail is the best there is
  const tail = lines.filter((l) => !/^at\s/.test(l)).slice(-4);
  return tail.join(" ").slice(0, 200);
}

function spawnProject(projectPath: string, command: RunCommand): Running {
  // This runs the project's own script, which is arbitrary code from the
  // developer's machine. That is the same thing they do in their terminal, and
  // ReqFlow is pointed at their project by them — but it is the reason the
  // command is shown before it runs rather than after.
  const child = spawn("npm", ["run", command.script], {
    cwd: key(projectPath),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
    // its own process group: `npm run dev` spawns the server as a child, and
    // killing only the wrapper leaves that child holding the port with nothing
    // watching it
    detached: true,
  });

  const held: Running = { child, command, output: [], stopping: false, since: Date.now() };

  const record = (chunk: Buffer) => {
    held.output.push(String(chunk));
    if (held.output.length > 200) held.output.shift();
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  child.on("exit", (code) => {
    if (!held.stopping && code) held.output.push(`\nexited with code ${code}\n`);
  });

  running.set(key(projectPath), held);
  return held;
}

// Answers whether there was anything of ours to stop, so the caller does not
// have to work that out by comparing paths. Comparing them outside here was
// exactly the bug: the route matched the raw path against the resolved key, so
// stopping a project reported "ReqFlow was not running that project" while
// stopping it.
export async function stopProject(projectPath: string): Promise<boolean> {
  const held = running.get(key(projectPath));
  if (!held) return false;

  held.stopping = true;
  running.delete(key(projectPath));

  if (held.child.exitCode === null) {
    // the npm script sits between us and the server, so the whole group goes
    try {
      process.kill(-held.child.pid!, "SIGTERM");
    } catch {
      held.child.kill("SIGTERM");
    }

    await Promise.race([
      new Promise<void>((resolve) => held.child.on("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);

    if (held.child.exitCode === null) held.child.kill("SIGKILL");
  }

  return true;
}

// Which of the three things happened, so the app can say it rather than imply
// it. "Running" over a server the developer started themselves would be a claim
// on something that is not ours, and the offer to stop it would be worse.
export type Ownership =
  // ReqFlow started it, and can stop it
  | "started"
  | "restarted"
  // it was already up and is not ReqFlow's
  | "existing"
  // nothing is running and ReqFlow could not change that
  | "none";

export interface RunOutcome {
  started: boolean;
  // whether ReqFlow is the one running it now
  owned: boolean;
  ownership: Ownership;
  waitedMs: number;
  command: string | null;
  detail: string;
}

// Start the project and wait for it to answer. Refuses when something is already
// listening that we did not start: that is someone's own server, and a second
// copy would either fail to bind or, worse, bind somewhere else and be tested
// instead of theirs.
export async function startProject(
  projectPath: string,
  baseUrl: string,
  signal?: AbortSignal
): Promise<RunOutcome> {
  const command = detectRunCommand(projectPath);
  if (!command) {
    return {
      started: false,
      owned: false,
      ownership: "none",
      waitedMs: 0,
      command: null,
      detail:
        "this project has no dev, start or serve script, so ReqFlow does not know how to run it",
    };
  }

  const already = await waitForServer(baseUrl, 1200, signal);
  if (already.up && !isOurs(projectPath)) {
    return {
      started: false,
      owned: false,
      ownership: "existing",
      waitedMs: already.waitedMs,
      command: command.command,
      detail: "something is already listening there, and it is not ReqFlow's to restart",
    };
  }

  spawnProject(projectPath, command);
  const ready = await waitForServer(baseUrl, READY_TIMEOUT_MS, signal);

  if (!ready.up) {
    // a server started for a run that was then cancelled, and which never
    // answered, is nobody's: it is stopped rather than left behind
    const said = lastOutput(projectPath);
    await stopProject(projectPath);
    return {
      started: false,
      owned: false,
      ownership: "none",
      waitedMs: ready.waitedMs,
      command: command.command,
      detail: said || `${command.command} did not answer on ${baseUrl}`,
    };
  }

  return {
    started: true,
    owned: true,
    ownership: "started",
    waitedMs: ready.waitedMs,
    command: command.command,
    detail: `started with ${command.command}`,
  };
}

// Bring our own copy down and up again so the change on disk is the code that
// answers. Only ever for a process ReqFlow started.
export async function restartProject(
  projectPath: string,
  baseUrl: string,
  signal?: AbortSignal
): Promise<RunOutcome> {
  if (!isOurs(projectPath)) {
    return {
      started: false,
      owned: false,
      ownership: "existing",
      waitedMs: 0,
      command: null,
      detail: "ReqFlow did not start this server, so it is not ReqFlow's to restart",
    };
  }

  const command = running.get(key(projectPath))!.command;
  await stopProject(projectPath);
  spawnProject(projectPath, command);

  const ready = await waitForServer(baseUrl, READY_TIMEOUT_MS, signal);
  if (!ready.up) {
    const said = lastOutput(projectPath);
    return {
      started: false,
      owned: false,
      ownership: "none",
      waitedMs: ready.waitedMs,
      command: command.command,
      detail: said || `it did not come back on ${baseUrl}`,
    };
  }

  return {
    started: true,
    owned: true,
    ownership: "restarted",
    waitedMs: ready.waitedMs,
    command: command.command,
    detail: `restarted with ${command.command}`,
  };
}

// Nothing ReqFlow started should outlive it holding a port.
export async function stopAll(): Promise<void> {
  await Promise.all([...running.keys()].map((p) => stopProject(p)));
}

// For the paths that cannot wait: process exit and an uncaught throw. No grace
// period and no confirmation that it worked, which is why it is not the way this
// normally happens — but a server left running by a crash is one the developer
// never chose and will not think to look for.
export function stopAllSync(): void {
  for (const [, held] of running) {
    if (held.child.exitCode !== null) continue;
    held.stopping = true;
    try {
      process.kill(-held.child.pid!, "SIGKILL");
    } catch {
      try {
        held.child.kill("SIGKILL");
      } catch {
        // the process is already gone, which is the outcome we wanted
      }
    }
  }
  running.clear();
}
