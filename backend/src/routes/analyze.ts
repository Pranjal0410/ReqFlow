import { Router, Request, Response } from "express";
import crypto from "crypto";
import { readProjectFilesCapped, UnreadableFolderError } from "../services/fileReader";
import { analyzeCode } from "../services/gemini";
import { buildOpenApi } from "../services/openapi";
import { detectPort } from "../services/portDetector";
import { DetectedRoute } from "../types";

import { findRouteSource } from "../services/routeSource";

const router = Router();

// The code behind an endpoint the project already has.
//
// Generated endpoints carry their source with them; scanned ones do not, and
// "show me what serves this" is the same question for both. Read-only: this
// returns what is on disk and nothing here writes.
router.post("/source", (req: Request, res: Response) => {
  const { projectPath, method, path: routePath } = req.body || {};

  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });
  if (!method || !routePath) return res.status(400).json({ error: "method and path are required" });

  try {
    const found = findRouteSource(String(projectPath), String(method), String(routePath));
    if (!found) {
      return res.json({
        found: false,
        // said in terms of what was looked for, so it can be checked
        detail: `No handler for ${String(method).toUpperCase()} ${routePath} was found in this project's source.`,
      });
    }
    res.json({ found: true, ...found });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// re-scanning the same folder used to re-send every file to gemini, which is
// the slowest part of a scan and the one with a daily quota. the fingerprint
// means edited code still gets a fresh look instead of a stale cached answer.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  fingerprint: string;
  routes: DetectedRoute[];
  filesScanned: number;
  at: number;
}

const cache = new Map<string, CacheEntry>();

// Being refused a folder is not a fault in the server, and a 500 says it is.
// The distinction matters here because the message is the whole fix: it tells
// the user which permission to grant, and a 500 reads as "ReqFlow is broken".
function failed(res: Response, err: any) {
  if (err instanceof UnreadableFolderError) {
    return res.status(403).json({ error: err.message });
  }
  return res.status(500).json({ error: err.message });
}

// bumped when the analyze prompt changes, so a cached scan is not served with
// answers the old prompt produced
const PROMPT_VERSION = "3";

function fingerprint(files: { path: string; content: string }[]): string {
  const hash = crypto.createHash("sha1");
  hash.update(PROMPT_VERSION);
  for (const f of files) {
    hash.update(f.path);
    hash.update("\0");
    hash.update(f.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

// the scan modal calls this first so it can show a real file count while it
// waits on gemini, rather than an invented progress bar
router.post("/files", (req: Request, res: Response) => {
  const { projectPath } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: "projectPath is required" });
  }

  try {
    const { files, found, truncated } = readProjectFilesCapped(projectPath);
    // the scan modal fills its base url box from this, so the user confirms a
    // port rather than being asked to remember one
    res.json({
      filesScanned: files.length,
      filesFound: found,
      truncated,
      detectedPort: detectPort(projectPath, files),
    });
  } catch (err: any) {
    failed(res, err);
  }
});

// built from routes the client already has, so a re-scan is not needed and no
// model call is involved
router.post("/openapi", (req: Request, res: Response) => {
  const { routes, title, baseUrl } = req.body;

  if (!Array.isArray(routes) || routes.length === 0) {
    return res.status(400).json({ error: "routes are required. Scan a project first." });
  }

  try {
    res.json(buildOpenApi(routes, { title: title || "API", baseUrl }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const { projectPath } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: "projectPath is required" });
  }

  try {
    const { files, found, truncated } = readProjectFilesCapped(projectPath);

    if (files.length === 0) {
      return res.status(404).json({ error: "no route files found in that directory" });
    }

    const print = fingerprint(files);
    const hit = cache.get(projectPath);

    if (hit && hit.fingerprint === print && Date.now() - hit.at < CACHE_TTL_MS) {
      return res.json({
        routes: hit.routes,
        filesScanned: hit.filesScanned,
        filesFound: found,
        truncated,
        cached: true,
      });
    }

    const routes = await analyzeCode(files);
    cache.set(projectPath, {
      fingerprint: print,
      routes,
      filesScanned: files.length,
      at: Date.now(),
    });

    res.json({ routes, filesScanned: files.length, filesFound: found, truncated, cached: false });
  } catch (err: any) {
    failed(res, err);
  }
});

export default router;
