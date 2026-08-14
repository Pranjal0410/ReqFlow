const fs = require("fs");
const os = require("os");
const path = require("path");
const { readApiKey, writeApiKey, looksLikeKey, KEY_NAME } = require("../apiKey");

const dirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-key-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
afterEach(() => delete process.env[KEY_NAME]);

// The first real key this was tested against starts with AQ. — not the AIza
// prefix an earlier version of looksLikeKey insisted on. A rule that refuses a
// working credential is worse than no rule, because the user has no way to
// argue with it, so only the paste mistakes are caught now.
describe("looksLikeKey", () => {
  it("accepts the key formats Google actually issues", () => {
    expect(looksLikeKey("AIzaSyD-1234567890abcdefghijklmnopqrstu")).toBe(true);
    expect(looksLikeKey("AQ.Ab8RN6IuXbn0dQzFakeFakeFakeFakeFakeFake")).toBe(true);
  });

  it("accepts a format nobody here has seen yet", () => {
    expect(looksLikeKey("sk-something-entirely-different-000000")).toBe(true);
  });

  it("refuses the whole env line, which is the usual paste mistake", () => {
    expect(looksLikeKey("GEMINI_API_KEY=AIzaSyD-1234567890abcdefghijkl")).toBe(false);
  });

  it("refuses a value with whitespace in it", () => {
    expect(looksLikeKey("AIzaSyD 1234567890abcdefghijklmnop")).toBe(false);
  });

  it("refuses something far too short to be a key", () => {
    expect(looksLikeKey("hello")).toBe(false);
    expect(looksLikeKey("")).toBe(false);
    expect(looksLikeKey(null)).toBe(false);
  });

  it("ignores the surrounding whitespace a copy adds", () => {
    expect(looksLikeKey("  AIzaSyD-1234567890abcdefghijklmnop  ")).toBe(true);
  });
});

describe("readApiKey", () => {
  it("prefers the environment over anything on disk", () => {
    const userDataDir = tempDir();
    writeApiKey({ userDataDir }, "from-the-user-file-0000000");
    process.env[KEY_NAME] = "from-the-environment-0000";

    expect(readApiKey({ userDataDir })).toBe("from-the-environment-0000");
  });

  // a developer with the repo already set up should never be asked for a key
  // they have already provided
  it("falls back to the repo's own .env", () => {
    const userDataDir = tempDir();
    const repoDir = tempDir();
    const repoEnvPath = path.join(repoDir, ".env");
    fs.writeFileSync(repoEnvPath, `${KEY_NAME}=from-the-repo-000000000000\n`);

    expect(readApiKey({ userDataDir, repoEnvPath })).toBe("from-the-repo-000000000000");
  });

  it("prefers what the app saved over the repo's", () => {
    const userDataDir = tempDir();
    const repoDir = tempDir();
    const repoEnvPath = path.join(repoDir, ".env");
    fs.writeFileSync(repoEnvPath, `${KEY_NAME}=from-the-repo-000000000000\n`);
    writeApiKey({ userDataDir }, "from-the-user-file-0000000");

    expect(readApiKey({ userDataDir, repoEnvPath })).toBe("from-the-user-file-0000000");
  });

  it("returns null when there is nothing anywhere, which is what triggers the prompt", () => {
    expect(readApiKey({ userDataDir: tempDir() })).toBeNull();
  });

  it("reads a value that was written with quotes around it", () => {
    const userDataDir = tempDir();
    fs.writeFileSync(path.join(userDataDir, ".env"), `${KEY_NAME}="quoted-value-00000000000"\n`);

    expect(readApiKey({ userDataDir })).toBe("quoted-value-00000000000");
  });
});

describe("writeApiKey", () => {
  it("creates the file and reads back what it wrote", () => {
    const userDataDir = tempDir();
    writeApiKey({ userDataDir }, "a-perfectly-good-key-00000");

    expect(readApiKey({ userDataDir })).toBe("a-perfectly-good-key-00000");
  });

  it("replaces the key without disturbing anything else in the file", () => {
    const userDataDir = tempDir();
    fs.writeFileSync(
      path.join(userDataDir, ".env"),
      `SOMETHING_ELSE=keep-me\n${KEY_NAME}=old-key-000000000000000\n`
    );
    writeApiKey({ userDataDir }, "new-key-000000000000000");

    const written = fs.readFileSync(path.join(userDataDir, ".env"), "utf-8");
    expect(written).toContain("SOMETHING_ELSE=keep-me");
    expect(written).toContain(`${KEY_NAME}=new-key-000000000000000`);
    expect(written).not.toContain("old-key");
  });

  // the file holds a credential, so it is not left readable by every account
  // on the machine
  it("writes it owner-readable only", () => {
    const userDataDir = tempDir();
    const file = writeApiKey({ userDataDir }, "a-perfectly-good-key-00000");

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
