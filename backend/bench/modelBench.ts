/**
 * Which model should write code that goes into a real project, decided by
 * evidence rather than by reputation or by size.
 *
 * The question is not "which model is best" but "which model can be trusted".
 * A model that answers twice as fast and breaks the project one run in three has
 * made the product worse, so every row here is measured over repeated runs and
 * scored by doing rather than by reading: the code is written into a throwaway
 * copy of a real project, parsed, booted, called, and read back.
 *
 * Gemini is a column, not a footnote. The decision this exists to settle is
 * whether running locally is good enough to stop calling out at all, and without
 * the hosted model on the same tasks there is nothing to answer that against.
 *
 *   npx tsx bench/modelBench.ts [runsPerTask]
 */
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawn, execFileSync, ChildProcess } from "child_process";
import { fixture, TASKS, styleViolations, contractBreaks, Task, Caller } from "./fixture";

const MODELS_DIR = path.join(os.homedir(), "Library", "Application Support", "ReqFlow", "models");

interface Candidate {
  label: string;
  // absent for the hosted model, which has no file
  file?: string;
  hosted?: boolean;
}

const CANDIDATES: Candidate[] = [
  { label: "Gemini flash-lite", hosted: true },
  { label: "Phi-4-mini 3.8B", file: "phi-4-mini-instruct-q4.gguf" },
  { label: "Qwen2.5-Coder 1.5B", file: "qwen2.5-coder-1.5b-q4.gguf" },
  { label: "Qwen2.5-Coder 3B", file: "qwen2.5-coder-3b-q4.gguf" },
];

interface RunResult {
  task: string;
  totalMs: number;
  produced: boolean;
  parses: boolean;
  boots: boolean;
  works: boolean;
  styleViolations: string[];
  // the router calling something the service does not export. its own row
  // because nothing else sees it: the files compile, the server boots, and only
  // the new endpoint answers "is not a function".
  contractBreaks: string[];
  why: string | null;
  error: string | null;
  code: string | null;
}

/* ------------------------------------------------------------- the harness */

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
  });
}

function callerFor(port: number): Caller {
  return (method, urlPath, body) =>
    new Promise((resolve) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {},
          timeout: 5000,
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            let json: any = raw;
            try {
              json = JSON.parse(raw);
            } catch {
              /* not json, keep the text */
            }
            resolve({ status: res.statusCode || 0, json });
          });
        }
      );
      req.on("error", () => resolve({ status: 0, json: null }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: 0, json: null });
      });
      if (payload) req.write(payload);
      req.end();
    });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What the applied service actually exports, asked of node rather than guessed
// from the source. Run in a child so a service that throws on load cannot take
// the benchmark with it.
function serviceExports(projectDir: string): string[] {
  try {
    const out = execFileSync(
      process.execPath,
      ["-e", "process.stdout.write(Object.keys(require('./services/users')).join(','))"],
      { cwd: projectDir, encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    );
    return out.split(",").map((n) => n.trim()).filter(Boolean);
  } catch {
    // it would not even load, which the boot check reports in its own words
    return [];
  }
}

async function bootAndCheck(
  projectDir: string,
  port: number,
  task: Task
): Promise<{ boots: boolean; works: boolean; why: string | null }> {
  let child: ChildProcess | null = null;
  // "it did not boot" is the absence of a finding. What the process said is the
  // finding, and without it the table cannot tell a model's fault from ours —
  // which is exactly what happened once already here.
  let output = "";

  try {
    child = spawn(process.execPath, ["server.js"], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (c) => (output += c));
    child.stderr?.on("data", (c) => (output += c));

    const call = callerFor(port);
    let up = false;
    for (let i = 0; i < 40; i++) {
      if (child.exitCode !== null) break;
      if ((await call("GET", "/api/users")).status > 0) {
        up = true;
        break;
      }
      await wait(150);
    }

    if (!up) {
      const line =
        output.split("\n").find((l) => /Error|error:|throw|Cannot|is not/.test(l)) ||
        output.split("\n")[0];
      return { boots: false, works: false, why: (line || "no output").trim().slice(0, 130) };
    }

    const outcome = await task.check(call);
    return { boots: true, works: outcome.pass, why: outcome.why };
  } finally {
    child?.kill("SIGKILL");
  }
}

function writeProject(dir: string, port: number) {
  const project = fixture(port);
  for (const [rel, content] of Object.entries(project.files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  // express is linked rather than installed, so a run costs no npm time
  fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"), "dir");
}

async function oneRun(candidate: Candidate, task: Task, index: number): Promise<RunResult> {
  if (candidate.hosted) {
    delete process.env.LLM_PROVIDER;
    delete process.env.LOCAL_MODEL_PATH;
  } else {
    process.env.LLM_PROVIDER = "embedded";
    process.env.LOCAL_MODEL_PATH = path.join(MODELS_DIR, candidate.file!);
  }

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${index}-`));
  const port = await freePort();
  writeProject(projectDir, port);

  const result: RunResult = {
    task: task.id,
    totalMs: 0,
    produced: false,
    parses: false,
    boots: false,
    works: false,
    styleViolations: [],
    contractBreaks: [],
    why: null,
    error: null,
    code: null,
  };

  const { generateEndpoint } = require("../src/services/codegen");
  const { planApply, applyPlan, parseError } = require("../src/services/applyCode");

  const started = Date.now();
  let generated: any;
  try {
    generated = await generateEndpoint(projectDir, task.description, []);
    result.totalMs = Date.now() - started;
    result.produced = true;
  } catch (err: any) {
    result.totalMs = Date.now() - started;
    result.error = String(err?.message || err).slice(0, 120);
    fs.rmSync(projectDir, { recursive: true, force: true });
    return result;
  }

  const routerLayer =
    generated.layers?.find((l: any) => /router|route/i.test(l.layer)) || generated.layers?.[0];
  if (!routerLayer) {
    result.error = "no code produced";
    fs.rmSync(projectDir, { recursive: true, force: true });
    return result;
  }

  result.code = routerLayer.code;
  result.styleViolations = styleViolations(routerLayer.code, "");

  try {
    const plan = planApply(projectDir, generated.layers);
    // the same check the product uses to refuse a write, so the benchmark and
    // the app cannot disagree about what "compiles" means
    const broken = plan.files.some((f: any) => parseError(f.absPath, f.nextContent));
    result.parses = !broken;

    if (broken) {
      result.why = "would not parse, so nothing was written";
    } else {
      applyPlan(plan);

      // measured on the applied project, before booting: a contract break is a
      // fact about the files, and it is worth knowing even when the server
      // happens to start
      const routerAfter = fs.readFileSync(path.join(projectDir, "routes", "users.js"), "utf-8");
      result.contractBreaks = contractBreaks(routerAfter, serviceExports(projectDir));

      const outcome = await bootAndCheck(projectDir, port, task);
      result.boots = outcome.boots;
      result.works = outcome.works;
      result.why = outcome.why;
    }
  } catch (err: any) {
    result.error = String(err?.message || err).slice(0, 120);
  }

  fs.rmSync(projectDir, { recursive: true, force: true });
  return result;
}

/* ---------------------------------------------------------------- reporting */

const pct = (n: number, of: number) => (of === 0 ? "-" : `${Math.round((n / of) * 100)}%`);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

(async () => {
  const runsPerTask = Number(process.argv[2] || 5);
  // a smoke run answers one question — did the patch remove the failure — and
  // burning sixty generations to ask it is how a benchmark stops being run
  const onlyTask = process.argv[3];
  const tasks = onlyTask ? TASKS.filter((t) => t.id === onlyTask) : TASKS;

  const available = CANDIDATES.filter(
    (c) => c.hosted || fs.existsSync(path.join(MODELS_DIR, c.file!))
  );
  for (const missing of CANDIDATES.filter((c) => !available.includes(c))) {
    console.log(`skipping ${missing.label}: ${missing.file} is not downloaded`);
  }

  const total = available.length * tasks.length * runsPerTask;
  console.log(
    `\n${tasks.length} tasks x ${runsPerTask} runs x ${available.length} models = ${total} generations,` +
      ` each applied to a fresh copy of the project and run.\n`
  );

  const table: Record<string, RunResult[]> = {};

  for (const candidate of available) {
    table[candidate.label] = [];
    for (const task of tasks) {
      for (let i = 0; i < runsPerTask; i++) {
        process.stdout.write(
          `  ${candidate.label.padEnd(20)} ${task.id.padEnd(17)} ${i + 1}/${runsPerTask}  `
        );
        const result = await oneRun(candidate, task, i);
        table[candidate.label].push(result);
        console.log(
          result.error
            ? `error: ${result.error}`
            : `${(result.totalMs / 1000).toFixed(1)}s  works=${result.works ? "yes" : "NO "}  style=${
                result.styleViolations.length
              }  contract=${result.contractBreaks.length}` +
              (result.why && !result.works ? `  (${result.why})` : "")
        );
      }
    }
    if (!candidate.hosted) {
      // the weights are held per path inside the provider; dropped between
      // models so two sets never share 16GB
      const { disposeEmbedded } = require("../src/services/llm");
      await disposeEmbedded();
    }
  }

  const labels = Object.keys(table);
  const width = 21;
  const row = (name: string, cell: (rs: RunResult[]) => string) =>
    `| ${name.padEnd(26)} | ${labels.map((l) => cell(table[l]).padEnd(width)).join(" | ")} |`;
  const share = (rs: RunResult[], has: (r: RunResult) => boolean) =>
    `${rs.filter(has).length}/${rs.length}  ${pct(rs.filter(has).length, rs.length)}`;

  console.log(`\n\n| ${"".padEnd(26)} | ${labels.map((l) => l.padEnd(width)).join(" | ")} |`);
  console.log(`| ${"-".repeat(26)} | ${labels.map(() => "-".repeat(width)).join(" | ")} |`);
  console.log(
    row("Total generation (median)", (rs) => `${(median(rs.map((r) => r.totalMs)) / 1000).toFixed(1)}s`)
  );
  console.log(
    row("Slowest run", (rs) => `${(Math.max(...rs.map((r) => r.totalMs)) / 1000).toFixed(1)}s`)
  );
  console.log(row("Produced output at all", (rs) => share(rs, (r) => r.produced)));
  console.log(row("Compiles", (rs) => share(rs, (r) => r.parses)));
  console.log(row("Server still boots", (rs) => share(rs, (r) => r.boots)));
  console.log(row("Endpoint actually works", (rs) => share(rs, (r) => r.works)));
  console.log(
    row("Cross-file contract holds", (rs) => share(rs, (r) => r.parses && r.contractBreaks.length === 0))
  );
  console.log(row("Clean style", (rs) => share(rs, (r) => r.styleViolations.length === 0)));
  console.log(
    row(
      "Needs a human fix",
      (rs) =>
        share(
          rs,
          (r) => !r.works || r.styleViolations.length > 0 || r.contractBreaks.length > 0
        )
    )
  );

  console.log(`\nper task, share of runs where the endpoint actually worked:`);
  console.log(`| ${"".padEnd(26)} | ${labels.map((l) => l.padEnd(width)).join(" | ")} |`);
  for (const task of tasks) {
    const cells = labels.map((l) => {
      const rs = table[l].filter((r) => r.task === task.id);
      return `${pct(rs.filter((r) => r.works).length, rs.length)}`.padEnd(width);
    });
    console.log(`| ${task.id.padEnd(26)} | ${cells.join(" | ")} |`);
  }

  console.log(`\nwhat went wrong:`);
  for (const label of labels) {
    const problems = table[label]
      .flatMap((r) => [
        ...r.styleViolations,
        ...r.contractBreaks,
        ...(r.error ? [r.error] : []),
        ...(r.why && !r.works ? [r.why] : []),
      ])
      .reduce((acc: Record<string, number>, p) => ({ ...acc, [p]: (acc[p] || 0) + 1 }), {});

    const listed = Object.entries(problems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([p, n]) => `      ${n}x ${p}`)
      .join("\n");
    console.log(`  ${label}:\n${listed || "      nothing"}`);
  }
})();
