import { Router, Request, Response } from "express";
import { getProvider, providerName } from "../services/llm";
import { readableModelError } from "../services/modelErrors";
import { coerceProvider, readSettings, writeSettings } from "../services/settings";

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
      settings: readSettings(),
    });
  } catch (err: any) {
    res.json({
      ok: false,
      provider: provider.name,
      model: provider.model,
      local: provider.local,
      configured: providerName(),
      detail: readableModelError(err),
      settings: readSettings(),
    });
  }
});

// Changing which model does the work, and what it needs to do it.
//
// The key is write-only. It arrives here, it is applied, and it is never sent
// back — readSettings() reports whether one is set, never what it is. A field
// that redisplays a credential is a field that puts it in the next screenshot.
router.put("/", async (req: Request, res: Response) => {
  const { provider, apiKey, localModelUrl, localModelPath, localModel } = req.body || {};

  const patch: Record<string, string> = {};

  if (provider !== undefined) patch.LLM_PROVIDER = coerceProvider(provider);

  // A blank key means "leave the one you have" rather than "delete it": the
  // field is empty on every visit, because it never shows what is stored, and
  // saving an unrelated change must not wipe the credential.
  if (typeof apiKey === "string" && apiKey.trim()) patch.GEMINI_API_KEY = apiKey.trim();

  if (typeof localModelUrl === "string") patch.LOCAL_MODEL_URL = localModelUrl.trim();
  if (typeof localModelPath === "string") patch.LOCAL_MODEL_PATH = localModelPath.trim();
  if (typeof localModel === "string") patch.LOCAL_MODEL = localModel.trim();

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "nothing to change" });
  }

  const { saved, storedAt } = writeSettings(patch);

  res.json({
    // applied either way: the setting is live in this process before the file is
    // touched, so a failed write costs the next launch, not this one
    applied: true,
    saved,
    storedAt,
    settings: readSettings(),
    detail: saved
      ? undefined
      : `This is in use now, but could not be written to ${storedAt}, so it will not survive a restart.`,
  });
});

export default router;
