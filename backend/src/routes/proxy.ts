import { Router, Request, Response } from "express";
import { forwardRequest } from "../services/proxy";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { method, url, headers, body } = req.body;

  if (!method || !url) {
    return res.status(400).json({ error: "method and url are required" });
  }

  try {
    const result = await forwardRequest({ method, url, headers, body });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;