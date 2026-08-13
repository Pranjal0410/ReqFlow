import fs from "fs";
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

export function readProjectFiles(projectPath: string): { path: string; content: string }[] {
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