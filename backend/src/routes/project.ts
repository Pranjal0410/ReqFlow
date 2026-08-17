import { Router, Request, Response } from "express";
import { runningProjects, stopProject, detectRunCommand } from "../services/projectRunner";

const router = Router();

// What ReqFlow is running on the developer's behalf, and how to stop it.
//
// The app spawns their project so that applying a change and finding out whether
// it worked is one action. That is a real convenience and it comes with a real
// obligation: a process this app started, that the developer can neither see nor
// stop, is not convenience — it is their machine running a server they never
// started and cannot find. So it is named, and there is a button.
router.get("/", (_req: Request, res: Response) => {
  res.json({ running: runningProjects() });
});

// Only ever the process ReqFlow itself spawned, found by the handle it kept
// rather than by looking for whatever holds the port. Something else listening
// on that port is somebody's own server, and "stop" must never be able to reach
// it however sure the app feels.
router.post("/stop", async (req: Request, res: Response) => {
  const { projectPath } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: "projectPath is required" });
  }

  // asked of the runner rather than worked out by comparing paths here: the
  // runner resolves symlinks to decide what is the same project, and comparing
  // spellings out here got that wrong
  const stopped = await stopProject(String(projectPath));

  res.json({
    stopped,
    // false here is not a failure: it means ReqFlow was not the one running it,
    // and the honest answer is that there was nothing of ours to stop
    detail: stopped ? "stopped" : "ReqFlow was not running that project",
    running: runningProjects(),
  });
});

// Whether ReqFlow would know how to run this project at all, so the app can say
// so before the developer discovers it at the moment they press Apply.
router.get("/command", (req: Request, res: Response) => {
  const projectPath = String(req.query.projectPath || "");
  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });

  res.json({ command: detectRunCommand(projectPath) });
});

export default router;
