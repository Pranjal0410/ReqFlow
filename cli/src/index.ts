#!/usr/bin/env node
// reqflow run — the workspace, without the workspace.
//
// Exit code is the whole point: 0 when every assertion held, 1 when one did
// not. Everything printed is for the person reading the log afterwards.

import fs from "fs";
import path from "path";
import { runCollection, RequestOutcome } from "./run";

const FILENAME = "reqflow.collection.json";

interface Args {
  file: string | null;
  baseUrl?: string;
  variables: Record<string, string>;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { file: null, variables: {}, json: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--var") {
      // --var token=abc. The values a committed file is not allowed to hold
      // have to come from somewhere, and this is the somewhere.
      const pair = argv[++i] || "";
      const at = pair.indexOf("=");
      if (at > 0) out.variables[pair.slice(0, at).trim()] = pair.slice(at + 1);
    } else if (arg === "run") continue;
    else if (!arg.startsWith("-") && !out.file) out.file = arg;
  }

  return out;
}

// Given nothing, look where the app writes it, then one level up — a collection
// beside the code is the normal case, and being run from a subdirectory is not
// worth an error message.
export function findCollection(from: string): string | null {
  let dir = path.resolve(from);
  for (let depth = 0; depth < 4; depth++) {
    const candidate = path.join(dir, FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const USAGE = `reqflow run [file] — send the requests in a ReqFlow collection

  file               a ${FILENAME}; found automatically if left out
  --base-url <url>   send the same requests somewhere else
  --var name=value   a value for {{name}}, for the ones the file cannot hold
  --json             print the result as JSON instead of as text
  -h, --help         this

Exits 1 if any assertion failed or any request could not be made.`;

function line(outcome: RequestOutcome): string {
  const mark = outcome.error ? "!" : outcome.failures.length ? "x" : "ok";
  const status = outcome.error ? "—" : String(outcome.status);
  const captured = outcome.captured.length ? `  captured ${outcome.captured.join(", ")}` : "";
  return `  ${mark.padEnd(3)} ${status.padEnd(4)} ${outcome.ms.toString().padStart(5)}ms  ${outcome.name}${captured}`;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const file = args.file || findCollection(process.cwd());
  if (!file) {
    console.error(`No ${FILENAME} here or above. Save one from ReqFlow, or name a file.`);
    return 1;
  }
  if (!fs.existsSync(file)) {
    console.error(`${file} does not exist`);
    return 1;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err: any) {
    console.error(`${file} is not valid JSON: ${err?.message}`);
    return 1;
  }

  let result;
  try {
    result = await runCollection(parsed, {
      baseUrl: args.baseUrl,
      variables: args.variables,
      onRequest: args.json ? undefined : (o) => console.log(line(o)),
    });
  } catch (err: any) {
    console.error(err?.message || "the run could not be started");
    return 1;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // the failures again at the end, because the interesting three lines of a
    // hundred line log should not have to be found by scrolling
    for (const outcome of result.outcomes) {
      if (outcome.error) console.log(`\n  ${outcome.name}: ${outcome.error}`);
      for (const failure of outcome.failures) console.log(`\n  ${outcome.name}: ${failure}`);
    }
    // A collection with no assertions in it sends every request, checks none of
    // them, and exits zero. That is the correct exit code — nothing was
    // asserted, so nothing failed — and it is also indistinguishable in a
    // pipeline from a run that verified something. Every request in this run
    // came back 401 the first time it was tried, and the summary said the same
    // thing it says when they all come back 200. So it says which it was.
    const checked = result.passed + result.failed;
    const parts = checked
      ? [`${result.passed} passed`]
      : ["nothing checked — no assertions in this collection"];
    if (result.failed) parts.push(`${result.failed} failed`);
    if (result.errored) parts.push(`${result.errored} could not be sent`);
    console.log(`\n${result.outcomes.length} requests, ${parts.join(", ")}`);
  }

  return result.failed > 0 || result.errored > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.message || err);
      process.exit(1);
    }
  );
}
