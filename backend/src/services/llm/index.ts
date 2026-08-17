import { LlmProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { LocalProvider } from "./local";
import { EmbeddedProvider } from "./embedded";

export * from "./types";
export { GeminiProvider } from "./gemini";
export { LocalProvider } from "./local";
export { EmbeddedProvider, dispose as disposeEmbedded } from "./embedded";

// Which model does the work. One switch rather than three, so the scan, the code
// generator and the agent cannot end up on different providers and produce
// answers in two different styles.
// embedded  the model runs inside this process, from a .gguf on disk
// local     a runtime on this machine, reached over the OpenAI-compatible API
// gemini    the hosted default
//
// The desktop app sets "embedded", because that is the version with nothing to
// install and nothing to keep running. "local" stays for a developer who
// already has Ollama and would rather use it.
export type ProviderName = "gemini" | "local" | "embedded";

export function providerName(): ProviderName {
  const raw = String(process.env.LLM_PROVIDER || "").toLowerCase();
  if (raw === "local") return "local";
  if (raw === "embedded") return "embedded";
  return "gemini";
}

// Whether the work happens on this machine, whichever of the two local shapes
// is in use. Asked often enough to be worth a name.
export function isLocal(): boolean {
  return providerName() !== "gemini";
}

// Each of the three jobs keeps its own model setting, because they are not the
// same job: scanning a project is bulk extraction and the cheapest model does
// it, while writing code is the one worth spending on. That was already true of
// the Gemini settings and it stays true locally.
export type Job = "analyze" | "codegen" | "chat";

const GEMINI_MODELS: Record<Job, () => string> = {
  analyze: () => process.env.GEMINI_ANALYZE_MODEL || "gemini-3.1-flash-lite",
  codegen: () => process.env.GEMINI_CODEGEN_MODEL || "gemini-3.1-flash-lite",
  chat: () => process.env.GEMINI_CHAT_MODEL || "gemini-3.1-flash-lite",
};

const LOCAL_MODELS: Record<Job, () => string> = {
  analyze: () => process.env.LOCAL_ANALYZE_MODEL || process.env.LOCAL_MODEL || "phi4",
  codegen: () => process.env.LOCAL_CODEGEN_MODEL || process.env.LOCAL_MODEL || "phi4",
  chat: () => process.env.LOCAL_CHAT_MODEL || process.env.LOCAL_MODEL || "phi4",
};

// Built per call rather than once at import: the tests and the desktop wrapper
// both set the environment after this module is first loaded, and a provider
// captured at import time would be the one from before the key was written.
export function getProvider(job: Job): LlmProvider {
  const name = providerName();
  // one file, one loaded model, shared by all three jobs. loading a second
  // copy of the same weights for the code generator would double the memory
  // for nothing.
  if (name === "embedded") return new EmbeddedProvider();
  if (name === "local") return new LocalProvider(LOCAL_MODELS[job]());
  return new GeminiProvider(GEMINI_MODELS[job](), process.env.GEMINI_API_KEY || "");
}

// Strips the fences a model wraps its answer in when it has been asked not to.
// Every provider meets this, so it lives here rather than being written twice.
//
// The language tag has to go with the fence. An earlier version took the
// backticks off ```javascript and left the word behind, which is still valid
// JavaScript — a bare identifier — so it parsed, was written into the project,
// and brought the server down with "javascript is not defined". It cost a good
// model a benchmark before the boot check caught it.
export function stripFences(text: string): string {
  const trimmed = text.trim();

  const fenced = /^```[A-Za-z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/.exec(trimmed);
  if (fenced) return fenced[1].trim();

  // an unbalanced fence, which happens when the answer was cut off
  return trimmed
    .replace(/^```[A-Za-z0-9_+-]*[ \t]*\r?\n?/, "")
    .replace(/\r?\n?```[ \t]*$/, "")
    .trim();
}
