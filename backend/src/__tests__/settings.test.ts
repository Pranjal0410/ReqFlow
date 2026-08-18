import fs from "fs";
import os from "os";
import path from "path";
import {
  mergeDotenv,
  coerceProvider,
  readSettings,
  writeSettings,
  settingsFile,
} from "../services/settings";

// A settings screen that rewrites a developer's .env from scratch is a settings
// screen that eats their config. One line changes; the rest of the file — its
// comments, its ordering, the variables this app has never heard of — stays.
describe("mergeDotenv", () => {
  const file = `# my notes
PORT=4000
GEMINI_API_KEY=old-key
SOMETHING_ELSE=keep me
`;

  it("replaces a value in place", () => {
    const out = mergeDotenv(file, { GEMINI_API_KEY: "new-key" });
    expect(out).toContain("GEMINI_API_KEY=new-key");
    expect(out).not.toContain("old-key");
  });

  it("leaves everything it was not asked about", () => {
    const out = mergeDotenv(file, { GEMINI_API_KEY: "new-key" });
    expect(out).toContain("# my notes");
    expect(out).toContain("PORT=4000");
    expect(out).toContain("SOMETHING_ELSE=keep me");
  });

  it("appends a key the file does not have", () => {
    expect(mergeDotenv(file, { LLM_PROVIDER: "local" })).toContain("LLM_PROVIDER=local");
  });

  it("comments out rather than leaving an empty value behind", () => {
    // KEY= reads back as "" rather than as unset, which is a different thing
    const out = mergeDotenv(file, { GEMINI_API_KEY: "" });
    expect(out).toContain("# GEMINI_API_KEY=");
    expect(out).not.toMatch(/^GEMINI_API_KEY=$/m);
  });

  it("does not add a key that was asked to be empty and was never there", () => {
    expect(mergeDotenv("PORT=4000\n", { LOCAL_MODEL_URL: "" })).not.toContain("LOCAL_MODEL_URL");
  });
});

describe("coerceProvider", () => {
  it("takes the three it knows", () => {
    expect(coerceProvider("local")).toBe("local");
    expect(coerceProvider("embedded")).toBe("embedded");
    expect(coerceProvider("gemini")).toBe("gemini");
  });

  it("falls back to the default rather than trusting the caller", () => {
    expect(coerceProvider("something-else")).toBe("gemini");
    expect(coerceProvider(undefined)).toBe("gemini");
    expect(coerceProvider({ evil: true })).toBe("gemini");
  });
});

describe("writeSettings", () => {
  let dir: string;
  const before = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-settings-"));
    process.env.REQFLOW_SETTINGS_FILE = path.join(dir, ".env");
  });

  afterEach(() => {
    process.env = { ...before };
  });

  it("applies to this process before it writes anything", () => {
    writeSettings({ LLM_PROVIDER: "local" });
    expect(process.env.LLM_PROVIDER).toBe("local");
  });

  it("writes the same value it applied", () => {
    writeSettings({ GEMINI_API_KEY: "a-key" });
    expect(fs.readFileSync(settingsFile(), "utf-8")).toContain("GEMINI_API_KEY=a-key");
  });

  it("says where it put it", () => {
    const { saved, storedAt } = writeSettings({ LLM_PROVIDER: "embedded" });
    expect(saved).toBe(true);
    expect(storedAt).toBe(path.join(dir, ".env"));
  });

  it("ignores a key it does not own, so a caller cannot write arbitrary env", () => {
    writeSettings({ PATH: "/tmp/evil" } as any);
    expect(process.env.PATH).not.toBe("/tmp/evil");
    expect(fs.readFileSync(settingsFile(), "utf-8")).not.toContain("/tmp/evil");
  });

  it("still applies when the file cannot be written", () => {
    // the setting working now matters more than it lasting; the caller is told
    process.env.REQFLOW_SETTINGS_FILE = "/proc/nope/.env";
    const { saved } = writeSettings({ LLM_PROVIDER: "local" });
    expect(process.env.LLM_PROVIDER).toBe("local");
    expect(saved).toBe(false);
  });
});

describe("readSettings", () => {
  const before = { ...process.env };
  afterEach(() => {
    process.env = { ...before };
  });

  it("reports whether a key is set, never the key", () => {
    process.env.GEMINI_API_KEY = "a-real-credential";
    const shown = readSettings();
    expect(shown.keySet).toBe(true);
    expect(JSON.stringify(shown)).not.toContain("a-real-credential");
  });

  it("treats whitespace as no key at all", () => {
    process.env.GEMINI_API_KEY = "   ";
    expect(readSettings().keySet).toBe(false);
  });
});
