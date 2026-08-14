import fs from "fs";
import os from "os";
import path from "path";

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".expo"];
const VALID_EXT = [".js", ".ts", ".jsx", ".tsx"];

function walkDir(dir: string, files: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // a directory we are not allowed to open is not a reason to abandon the
    // scan of everything else
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // withFileTypes answers from the directory entry, so a symlink pointing at
    // something deleted is reported rather than throwing the way stat did. one
    // dangling link used to kill the whole scan with a raw ENOENT.
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(entry.name)) {
        walkDir(fullPath, files);
      }
    } else if (entry.isFile() && VALID_EXT.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

// Pointing at a home folder rather than a project turns up thousands of files.
// Concatenating those produced an 800MB prompt, which is not a slow scan, it is
// a backend that stops responding. The cap is on what gets sent; the caller is
// told how much was left out so the result is never passed off as complete.
export const MAX_SCAN_FILES = 300;
export const MAX_SCAN_CHARS = 500_000;

export interface ProjectFiles {
  files: { path: string; content: string }[];
  // how many matched before the cap, so a partial scan can say so
  found: number;
  truncated: boolean;
}

export function readProjectFilesCapped(projectPath: string): ProjectFiles {
  const all = readProjectFiles(projectPath);

  const files: { path: string; content: string }[] = [];
  let chars = 0;
  for (const file of all) {
    if (files.length >= MAX_SCAN_FILES) break;
    // one oversized file, a bundle or a minified vendor blob, used to stop the
    // loop dead and leave the scan with nothing. skip it and keep going.
    if (chars + file.content.length > MAX_SCAN_CHARS) continue;
    files.push(file);
    chars += file.content.length;
  }

  return { files, found: all.length, truncated: files.length < all.length };
}

// "~/projects/api" is what gets typed and pasted, and only a shell expands it
export function expandHome(input: string): string {
  const text = input.trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

export function readProjectFiles(rawPath: string): { path: string; content: string }[] {
  const projectPath = expandHome(rawPath);

  if (!fs.existsSync(projectPath)) {
    throw new Error(`path not found: ${projectPath}`);
  }

  const files = walkDir(projectPath);

  // only grab files that look like they have routes
  const routeKeywords = ["router", "app.get", "app.post", "app.put", "app.delete", "express", "Route"];

  const relevant = files
    .map((f) => {
      try {
        return { path: f, content: fs.readFileSync(f, "utf-8") };
      } catch {
        // deleted between the walk and the read, or simply unreadable. skipping
        // one file is better than failing the scan with its errno.
        return null;
      }
    })
    .filter((f): f is { path: string; content: string } => f !== null)
    .filter((f) => routeKeywords.some((kw) => f.content.includes(kw)));

  return relevant;
}