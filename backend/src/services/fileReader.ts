import fs from "fs";
import path from "path";

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".expo"];
const VALID_EXT = [".js", ".ts", ".jsx", ".tsx"];

function walkDir(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!SKIP_DIRS.includes(entry)) {
        walkDir(fullPath, files);
      }
    } else if (VALID_EXT.includes(path.extname(entry))) {
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
    .map((f) => ({
      path: f,
      content: fs.readFileSync(f, "utf-8"),
    }))
    .filter((f) => routeKeywords.some((kw) => f.content.includes(kw)));

  return relevant;
}