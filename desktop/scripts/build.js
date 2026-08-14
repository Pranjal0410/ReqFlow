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

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}   (in ${path.relative(ROOT, cwd) || "."})`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function size(dir) {
  if (!fs.existsSync(dir)) return "0";
  return execFileSync("du", ["-sh", dir]).toString().split("\t")[0];
}

/* --------------------------------------------------------------- backend */

function buildBackend() {
  run("npm", ["run", "build"], BACKEND);
}

// The repo's node_modules is 121MB, nearly all of it jest, typescript and tsx —
// none of which the server uses at runtime. Installing the five production
// dependencies into a staging copy is the difference between a 250MB app and a
// 110MB one.
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
      },
      null,
      2
    )
  );

  // no lockfile is copied, so this resolves fresh. --omit=dev is what makes the
  // whole exercise worthwhile.
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], STAGING);
  console.log(`\nstaged backend: ${size(STAGING)} (repo node_modules is ${size(path.join(BACKEND, "node_modules"))})`);
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
