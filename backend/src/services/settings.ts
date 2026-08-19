import fs from "fs";
import path from "path";
import { ProviderName } from "./llm";

// Where the model settings live, and how changing them takes effect.
//
// Two things have to be true at once. A change made in Settings must apply to
// the very next request — nobody should have to restart the app to try a key
// they just pasted — and it must still be there tomorrow. So each write does
// both: it sets the value in this process, and it writes the same value to a
// dotenv file.
//
// The file is a dotenv rather than a format of our own because that is what the
// project already reads on a normal `npm run dev`, and what the desktop wrapper
// already knows how to seal into the OS keychain on its next launch.

const KEYS = [
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_ANALYZE_MODEL",
  "GEMINI_CODEGEN_MODEL",
  "GEMINI_CHAT_MODEL",
  "LOCAL_MODEL_URL",
  "LOCAL_MODEL_PATH",
  "LOCAL_MODEL",
] as const;

export type SettingKey = (typeof KEYS)[number];

// The desktop wrapper points this at its own writable folder; a developer
// running the backend directly gets backend/.env, which is the file they
// already edit by hand.
export function settingsFile(): string {
  const given = process.env.REQFLOW_SETTINGS_FILE;
  if (given && given.trim()) return given.trim();
  return path.resolve(process.cwd(), ".env");
}

// What Settings shows. The key itself is never in here: a credential that has
// been stored has no reason to travel back to a screen, and a field that
// redisplays it is a field that can leak it into a screenshot.
export interface ModelSettings {
  provider: ProviderName;
  keySet: boolean;
  analyzeModel: string;
  codegenModel: string;
  chatModel: string;
  localModelUrl: string;
  localModelPath: string;
  localModel: string;
  // where a change would be written, so the UI can say whether it will last
  storedAt: string;
  writable: boolean;
}

// What Settings saved, applied over what the process was started with.
//
// dotenv reads <cwd>/.env and refuses to overwrite a variable that is already
// set. Both of those are wrong here. The desktop wrapper keeps its settings
// somewhere else entirely, and it passes the key it read at launch into the
// child's environment — so a key the user changed afterwards would lose to the
// one they replaced, every time the backend restarted.
//
// The settings file is the user's most recent decision, so for the handful of
// variables this app owns, it wins. Nothing else in the environment is touched.
export function loadSettingsFile(): void {
  const file = settingsFile();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (!KEYS.includes(key as SettingKey)) continue;

    const value = raw.trim().replace(/^['"]|['"]$/g, "");
    if (value) process.env[key] = value;
  }
}

export function readSettings(): ModelSettings {
  const file = settingsFile();
  return {
    provider: coerceProvider(process.env.LLM_PROVIDER),
    keySet: !!(process.env.GEMINI_API_KEY || "").trim(),
    analyzeModel: process.env.GEMINI_ANALYZE_MODEL || "",
    codegenModel: process.env.GEMINI_CODEGEN_MODEL || "",
    chatModel: process.env.GEMINI_CHAT_MODEL || "",
    localModelUrl: process.env.LOCAL_MODEL_URL || "",
    localModelPath: process.env.LOCAL_MODEL_PATH || "",
    localModel: process.env.LOCAL_MODEL || "",
    storedAt: file,
    writable: canWrite(file),
  };
}

export function coerceProvider(raw: any): ProviderName {
  const name = String(raw || "").toLowerCase();
  if (name === "local") return "local";
  if (name === "embedded") return "embedded";
  return "gemini";
}

function canWrite(file: string): boolean {
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(fs.existsSync(file) ? file : dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Applied to this process first, then written down.
//
// In that order deliberately: if the write fails — a read-only bundle, a folder
// that does not exist — the setting still works for this session, and the caller
// is told it will not outlive it. The opposite order would leave a saved file
// that the running app is not using.
export function writeSettings(patch: Partial<Record<SettingKey, string>>): {
  saved: boolean;
  storedAt: string;
} {
  // Filtered once, and both the process and the file are given the same thing.
  // They used to be filtered separately — and the file was not filtered at all,
  // so a caller could put any variable it liked into a dotenv this app reads at
  // startup. PATH, for one.
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!KEYS.includes(key as SettingKey)) continue;
    if (value === undefined) continue;
    allowed[key] = value;
    if (value === "") delete process.env[key];
    else process.env[key] = value;
  }

  const file = settingsFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
    fs.writeFileSync(file, mergeDotenv(existing, allowed), { mode: 0o600 });
    return { saved: true, storedAt: file };
  } catch {
    return { saved: false, storedAt: file };
  }
}

// One line replaced, everything else left alone — comments, ordering, and any
// variable this app does not know about. A settings screen that rewrites a
// developer's .env from scratch is a settings screen that eats their config.
export function mergeDotenv(
  existing: string,
  patch: Partial<Record<string, string>>
): string {
  let out = existing;

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const line = `${key}=${value}`;
    const found = new RegExp(`^\\s*${key}\\s*=.*$`, "m");

    if (found.test(out)) {
      // an empty value means "unset", and a commented-out line says that in the
      // file's own terms rather than leaving KEY= behind for dotenv to read as ""
      out = out.replace(found, value === "" ? `# ${key}=` : line);
    } else if (value !== "") {
      out = `${out.replace(/\s*$/, "")}\n${line}\n`.replace(/^\n/, "");
    }
  }

  return out.endsWith("\n") ? out : `${out}\n`;
}
