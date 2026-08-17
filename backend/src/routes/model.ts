import { Router, Request, Response } from "express";
import { getProvider, providerName } from "../services/llm";
import { readableModelError } from "../services/modelErrors";

const router = Router();

// Which model is doing the work, and whether it can actually be reached. Both
// halves matter: a local model that is not running fails in exactly the same
// place as a cloud key that is wrong, and the UI should be able to say which.
//
// The check is a real call to the provider, not a reading of the environment. A
// key being present tells you nothing about it being accepted, and an Ollama
// process being up tells you nothing about the model having been pulled.
router.get("/", async (_req: Request, res: Response) => {
  const provider = getProvider("chat");

  try {
    const health = await provider.health();
    // health() reports the provider's own words when the call fails, and for a
    // spent quota that is seven hundred characters of JSON. Settings puts this
    // string on one line beside a red dot, so it is turned into the same
    // sentence the agent would give — the failure a developer is most likely to
    // meet is the one they should least have to decode.
    res.json({
      ...health,
      detail: health.ok ? health.detail : readableModelError(health.detail),
      local: provider.local,
      configured: providerName(),
    });
  } catch (err: any) {
    res.json({
      ok: false,
      provider: provider.name,
      model: provider.model,
      local: provider.local,
      configured: providerName(),
      detail: readableModelError(err),
    });
  }
});

export default router;
