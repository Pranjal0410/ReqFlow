// A thin HTTP face on services/mockServer — the app has requests, this turns
// them into routes the mock can match on, keyed by the id it hands back so
// the app can check status or stop it later.

import { Router, Request, Response } from "express";
import { startMock, stopMock, mockStatus, listMocks, MockRoute } from "../services/mockServer";

const router = Router();

// {{BASE_URL}}/users/:id and query strings mean nothing to a server matching
// on the path it was actually asked for — strip both down to /users/:id
function toPath(url: string): string {
  const withoutBase = (url || "").replace(/^\{\{BASE_URL\}\}/, "");
  const withoutQuery = withoutBase.split("?")[0];
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

router.post("/", async (req: Request, res: Response) => {
  const { requests } = req.body || {};
  if (!Array.isArray(requests) || requests.length === 0) {
    return res.status(400).json({ error: "requests must be a non-empty array" });
  }

  const routes: MockRoute[] = requests.map((r: any) => ({
    method: r.method || "GET",
    path: toPath(r.url),
    sampleResponse: r.sampleResponse,
  }));

  res.json(await startMock(routes));
});

// what a reloaded frontend lost track of — this process is the only place
// still holding it, so it is the only place that can answer
router.get("/", (_req: Request, res: Response) => {
  res.json({ running: listMocks() });
});

router.get("/:id", (req: Request, res: Response) => {
  const status = mockStatus(String(req.params.id));
  if (!status) return res.status(404).json({ error: "no mock server with that id" });
  res.json(status);
});

router.delete("/:id", (req: Request, res: Response) => {
  if (!stopMock(String(req.params.id))) return res.status(404).json({ error: "no mock server with that id" });
  res.json({ stopped: true });
});

export default router;
