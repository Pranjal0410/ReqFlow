import { Router, Request, Response } from "express";
import { generateEndpoint } from "../services/codegen";

const router = Router();

// Code for an endpoint that does not exist yet, written in the style of the
// endpoints that do. Nothing here touches the user's files: the result is
// returned for them to read and copy, and writing it would be a separate
// decision with a separate confirmation.
router.post("/", async (req: Request, res: Response) => {
  const { projectPath, description } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: "projectPath is required. Scan a project first." });
  }
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: "description is required" });
  }

  try {
    res.json(await generateEndpoint(String(projectPath), String(description).trim()));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
