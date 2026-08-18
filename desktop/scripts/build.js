#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Everything that has to happen before Electron has anything to wrap. Kept as a
// script rather than a chain of && in package.json because two of the four steps
// need a reason written next to them.

const ROOT = path.join(__dirname, "..", "..");
const DESKTOP = path.join(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "frontend");
const STAGING = path.join(DESKTOP, "staging", "backend");

const only = process.argv[2]; // backend | frontend | stage, or all of them

// npm and npx are batch files on Windows, and execFile does not find those the
// way a shell would
const bin = (name) => (process.platform === "win32" ? `${name}.cmd` : name);

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}   (in ${path.relative(ROOT, cwd) || "."})`);
  execFileSync(bin(command), args, { cwd, stdio: "inherit" });
}

// du is not on Windows, and this is a line of build output rather than anything
// load-bearing, so it is counted here instead of shelling out for it
function size(dir) {
  if (!fs.existsSync(dir)) return "0";

  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    try {
      bytes += fs.statSync(path.join(entry.parentPath || entry.path, entry.name)).size;
    } catch {
      // a link to nothing, or a file that went away mid-count
    }
  }

  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${Math.round(mb)}M`;
}

/* --------------------------------------------------------------- backend */

function buildBackend() {
  run("npm", ["run", "build"], BACKEND);
}

// The repo's node_modules is 121MB, nearly all of it jest, typescript and tsx —
// none of which the server uses at runtime. Installing only the production
// dependencies into a staging copy is the difference between a 250MB app and a
// 110MB one.
//
// optionalDependencies comes along too, because node-llama-cpp is in there and
// it is what runs the model inside the app. It is optional in the sense that a
// machine without a prebuilt binary can still install and use the hosted model,
// not in the sense that the app can be shipped without it.
function stageBackend() {
  fs.rmSync(STAGING, { recursive: true, force: true });
  fs.mkdirSync(STAGING, { recursive: true });

  fs.cpSync(path.join(BACKEND, "dist"), path.join(STAGING, "dist"), { recursive: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, "package.json"), "utf-8"));
  fs.writeFileSync(
    path.join(STAGING, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        private: true,
        main: "dist/index.js",
        dependencies: pkg.dependencies,
        optionalDependencies: pkg.optionalDependencies,
      },
      null,
      2
    )
  );

  // no lockfile is copied, so this resolves fresh. --omit=dev is what makes the
  // whole exercise worthwhile.
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], STAGING);
  console.log(`\nstaged backend: ${size(STAGING)} (repo node_modules is ${size(path.join(BACKEND, "node_modules"))})`);

  // llama.cpp ships as a native binary per platform, and it is most of what the
  // staged backend now weighs. Said out loud because an installer that grew by
  // a hundred megabytes should not do so silently.
  const llama = path.join(STAGING, "node_modules", "node-llama-cpp");
  if (fs.existsSync(llama)) {
    console.log(`  of which node-llama-cpp: ${size(llama)} — this is what runs the model in-process`);
  } else {
    console.log("  node-llama-cpp did not install: this build can only use the hosted model");
  }
}

/* -------------------------------------------------------------- frontend */

// expo export:web was removed after SDK 49. This is the current spelling, and
// it writes absolute asset paths, which is why the app serves the result over
// http rather than loading it from file://.
function buildFrontend() {
  run("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist"], FRONTEND);

  const index = path.join(FRONTEND, "dist", "index.html");
  if (!fs.existsSync(index)) {
    throw new Error("expo export finished but produced no index.html");
  }
}

/* ------------------------------------------------------------------ main */

const steps = {
  backend: buildBackend,
  stage: stageBackend,
  frontend: buildFrontend,
};

const chosen = only ? [only] : ["backend", "stage", "frontend"];
for (const step of chosen) {
  if (!steps[step]) throw new Error(`unknown step "${step}"`);
  steps[step]();
}
console.log("\nbuild inputs ready.");
