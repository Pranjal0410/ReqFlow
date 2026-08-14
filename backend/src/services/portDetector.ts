import fs from "fs";
import path from "path";
import { expandHome } from "./fileReader";

// Where a project says it listens. Asking the user for a base url and leaving
// the box empty is how every scanned route ends up pointed at the wrong server,
// so the box is filled in from the code and they confirm it instead.

export interface DetectedPort {
  port: number;
  // shown next to the field, because a guess the user cannot trace is worse
  // than no guess at all
  source: string;
}

// 0 and anything above the tcp range are not ports, and a bare "3" is far more
// likely to be an array index than a server
function valid(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 80 && n <= 65535 ? n : null;
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

// an env file is the most explicit statement a project makes about its port
function fromEnvFile(projectPath: string): DetectedPort | null {
  for (const name of [".env", ".env.local", ".env.development"]) {
    const body = readIfPresent(path.join(projectPath, name));
    if (!body) continue;

    const match = body.match(/^\s*PORT\s*=\s*"?'?(\d+)"?'?\s*$/m);
    const port = match && valid(match[1]);
    if (port) return { port, source: name };
  }
  return null;
}

function fromPackageScripts(projectPath: string): DetectedPort | null {
  const body = readIfPresent(path.join(projectPath, "package.json"));
  if (!body) return null;

  try {
    const scripts = JSON.parse(body).scripts || {};
    for (const [name, command] of Object.entries(scripts)) {
      const match = String(command).match(/PORT\s*=\s*(\d+)/);
      const port = match && valid(match[1]);
      if (port) return { port, source: `package.json, ${name} script` };
    }
  } catch {
    // a package.json that will not parse is not worth failing a scan over
  }
  return null;
}

// last resort: the number written into the code itself
function fromSource(files: { path: string; content: string }[]): DetectedPort | null {
  const patterns = [
    /\.listen\(\s*(\d{2,5})/,
    /PORT\s*\|\|\s*(\d{2,5})/,
    /\bport\s*[:=]\s*(\d{2,5})\b/,
  ];

  for (const file of files) {
    for (const pattern of patterns) {
      const match = file.content.match(pattern);
      const port = match && valid(match[1]);
      if (port) return { port, source: path.basename(file.path) };
    }
  }
  return null;
}

export function detectPort(
  rawPath: string,
  files: { path: string; content: string }[]
): DetectedPort | null {
  const projectPath = expandHome(rawPath);
  return fromEnvFile(projectPath) || fromPackageScripts(projectPath) || fromSource(files);
}
