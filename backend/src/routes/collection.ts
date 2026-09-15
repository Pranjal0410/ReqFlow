// The workspace, as a file in the project it tests.
//
// Reading and writing one file, at one name, inside the folder the user already
// pointed the app at. Not an arbitrary path: the request names the project, and
// the filename is this app's, so there is no way to spell a path that lands
// anywhere else. The generated-code writer had to work hard for that guarantee
// because it takes paths; this one gets it by not taking one.

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { expandHome } from "../services/fileReader";
import { buildPostmanCollection, buildPostmanEnvironment } from "../services/postman";

const router = Router();

// the same name the app and the runner both look for
export const FILENAME = "reqflow.collection.json";

function fileIn(projectPath: string): string {
  return path.join(path.resolve(expandHome(String(projectPath))), FILENAME);
}

router.get("/", (req: Request, res: Response) => {
  const projectPath = req.query.projectPath;
  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });

  const file = fileIn(String(projectPath));
  if (!fs.existsSync(file)) {
    // not an error. Most projects do not have one yet, and the app asks before
    // it knows whether this is one of them.
    return res.json({ found: false, path: file });
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return res.json({ found: true, path: file, collection: parsed });
  } catch (err: any) {
    // a file that is there and unreadable is worth saying out loud, because the
    // alternative is the app quietly behaving as though it were not there
    return res.status(422).json({
      error: `${FILENAME} is not valid JSON: ${err?.message || "could not be read"}`,
      path: file,
    });
  }
});

router.post("/", (req: Request, res: Response) => {
  const { projectPath, collection } = req.body || {};
  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });
  if (!collection || typeof collection !== "object") {
    return res.status(400).json({ error: "collection must be an object" });
  }

  const root = path.resolve(expandHome(String(projectPath)));
  if (!fs.existsSync(root)) {
    return res.status(400).json({ error: `${root} is not a folder on this machine` });
  }

  const file = path.join(root, FILENAME);
  try {
    fs.writeFileSync(file, JSON.stringify(collection, null, 2) + "\n", "utf-8");
    return res.json({ written: true, path: file });
  } catch (err: any) {
    // the same refusal the code writer meets, and for the same reasons — a
    // folder the app was never granted, or one that is read only
    return res.status(403).json({
      error: `Could not write ${FILENAME}: ${err?.message || "permission denied"}`,
      code: "ACCESS_DENIED",
      path: file,
    });
  }
});

// built from the collection the client already has in memory, the same way
// the OpenAPI export is — no re-scan, no file on disk required
router.post("/postman", (req: Request, res: Response) => {
  const { collection } = req.body || {};
  if (!collection || typeof collection !== "object" || !Array.isArray(collection.requests)) {
    return res.status(400).json({ error: "collection must be an object with a requests array" });
  }

  try {
    const environments = Array.isArray(collection.environments) ? collection.environments : [];
    res.json({
      collection: buildPostmanCollection(collection),
      environments: environments.map(buildPostmanEnvironment),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
