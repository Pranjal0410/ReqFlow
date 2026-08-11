import { Router, Request, Response } from "express";
import { readProjectFiles } from "../services/fileReader";
import { analyzeCode } from "../services/gemini";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { projectPath } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: "projectPath is required" });
  }

  try {
    const files = readProjectFiles(projectPath);

    if (files.length === 0) {
      return res.status(404).json({ error: "no route files found in that directory" });
    }

    const routes = await analyzeCode(files);
    res.json({ routes, filesScanned: files.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;