import fs from "fs";
import os from "os";
import path from "path";

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".expo"];

// what makes a file look like it defines routes
const ROUTE_KEYWORDS = ["router", "app.get", "app.post", "app.put", "app.delete", "express", "Route"];
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
//
// The numbers come from measuring real projects rather than from taste. The
// ones to hand read 7 to 18 route files and 67k to 141k characters, so 300
// files and 800k characters leave roughly six times the largest of them. In
// tokens that is about 200k, which the scan model has room for alongside the
// prompt and its answer.
export const MAX_SCAN_FILES = 300;
export const MAX_SCAN_CHARS = 800_000;

export interface ProjectFiles {
  files: { path: string; content: string }[];
  // how many matched before the cap, so a partial scan can say so
  found: number;
  truncated: boolean;
}

// how many files are even opened. a folder deep enough to hold a hundred
// thousand of them should not be walked for minutes before being refused.
export const MAX_SCAN_EXAMINE = 5000;

export function readProjectFilesCapped(rawPath: string): ProjectFiles {
  const projectPath = expandHome(rawPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`path not found: ${projectPath}`);
  }

  // read one at a time and keep only what fits. reading everything first and
  // trimming afterwards still built the whole 800MB in memory, which is what
  // took the backend down rather than merely making the scan slow.
  const paths = walkDir(projectPath);
  const files: { path: string; content: string }[] = [];
  let chars = 0;
  let found = 0;

  for (const filePath of paths.slice(0, MAX_SCAN_EXAMINE)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (!ROUTE_KEYWORDS.some((kw) => content.includes(kw))) continue;
    found++;

    // counted but not kept, so the total stays honest without being held on to
    if (files.length >= MAX_SCAN_FILES) continue;
    if (chars + content.length > MAX_SCAN_CHARS) continue;

    files.push({ path: filePath, content });
    chars += content.length;
  }

  return { files, found, truncated: files.length < found };
}

// the codegen path ranks files by their name before deciding which ones are
// worth opening, so it needs the walk without the reading that follows it
export function listSourceFiles(rawPath: string): string[] {
  const projectPath = expandHome(rawPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`path not found: ${projectPath}`);
  }
  return walkDir(projectPath).slice(0, MAX_SCAN_EXAMINE);
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
    .filter((f) => ROUTE_KEYWORDS.some((kw) => f.content.includes(kw)));

  return relevant;
}