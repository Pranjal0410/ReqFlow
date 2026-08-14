#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// npm run start should just work on a fresh checkout. Rather than making the
// developer remember which of the two builds is missing, this runs only the
// steps whose output is not there. A rebuild after editing source is what
// npm run build is for; this is about never being told "not built yet".

const ROOT = path.join(__dirname, "..", "..");
const outputs = [
  { step: "backend", produces: path.join(ROOT, "backend", "dist", "index.js") },
  { step: "frontend", produces: path.join(ROOT, "frontend", "dist", "index.html") },
];

const missing = outputs.filter((o) => !fs.existsSync(o.produces));

if (missing.length === 0) {
  console.log("[desktop] backend and frontend builds are present");
} else {
  for (const { step } of missing) {
    console.log(`[desktop] ${step} is not built yet, building it`);
    execFileSync(process.execPath, [path.join(__dirname, "build.js"), step], { stdio: "inherit" });
  }
}
