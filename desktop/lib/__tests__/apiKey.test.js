const fs = require("fs");
const os = require("os");
const path = require("path");
const { readApiKey, writeApiKey, sealExistingKey, looksLikeKey, KEY_NAME } = require("../apiKey");

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
  // This asserted the opposite, and the assertion was the bug: a key exported in
  // some shell weeks ago beat the one the user had just typed into the prompt,
  // and the app then reported that key as invalid.
  it("prefers what the user stored over the environment", () => {
    const userDataDir = tempDir();
    writeApiKey({ userDataDir }, "from-the-user-file-0000000");
    process.env[KEY_NAME] = "from-the-environment-0000";

    expect(readApiKey({ userDataDir })).toBe("from-the-user-file-0000000");
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

// Electron's safeStorage, standing in for the platform keychain. The real one
// needs a running Electron app; what these tests are about is which file the
// key ends up in and what is left behind in the other one, and that is the same
// question either way.
// The transform is nothing — the real one is the platform's — but it has to at
// least not leave the key sitting in the file as itself, or the test that says
// so proves nothing.
const scramble = (buffer) => Buffer.from(buffer.map((byte) => byte ^ 0x5a));

const keychain = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => scramble(Buffer.from(text, "utf-8")),
  decryptString: (buffer) => scramble(Buffer.from(buffer)).toString("utf-8"),
};

const noKeychain = { isEncryptionAvailable: () => false };

// A session with no keyring at all — Linux without one running. Asking the
// question must not throw the launch away.
const brokenKeychain = {
  isEncryptionAvailable: () => {
    throw new Error("no keyring on this session");
  },
};

describe("storing the key where the platform can keep it", () => {
  const plainFile = (dir) => path.join(dir, ".env");

  it("does not leave the key readable on disk", () => {
    const userDataDir = tempDir();
    const file = writeApiKey({ userDataDir, safeStorage: keychain }, "a-real-looking-key-000000");

    expect(fs.readFileSync(file, "utf-8")).not.toContain("a-real-looking-key-000000");
    expect(fs.existsSync(plainFile(userDataDir))).toBe(false);
    expect(readApiKey({ userDataDir, safeStorage: keychain })).toBe("a-real-looking-key-000000");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("still stores the key when the platform has nowhere to keep it", () => {
    const userDataDir = tempDir();
    writeApiKey({ userDataDir, safeStorage: noKeychain }, "a-real-looking-key-000000");

    expect(readApiKey({ userDataDir, safeStorage: noKeychain })).toBe("a-real-looking-key-000000");
  });

  it("survives a keychain that throws when asked", () => {
    const userDataDir = tempDir();
    writeApiKey({ userDataDir, safeStorage: brokenKeychain }, "a-real-looking-key-000000");

    expect(readApiKey({ userDataDir, safeStorage: brokenKeychain })).toBe(
      "a-real-looking-key-000000"
    );
  });

  // An install from before this existed has the key sitting in plain text. The
  // point of moving it is that the plain copy stops existing, so a user who
  // updates is not left with the thing this was meant to stop.
  describe("an install that already has a plain key", () => {
    it("moves it into the keychain and takes the plain copy away", () => {
      const userDataDir = tempDir();
      fs.writeFileSync(plainFile(userDataDir), `${KEY_NAME}=an-existing-key-000000000\n`);

      expect(sealExistingKey({ userDataDir, safeStorage: keychain })).toMatchObject({
        moved: true,
        removed: true,
      });
      expect(fs.existsSync(plainFile(userDataDir))).toBe(false);
      expect(readApiKey({ userDataDir, safeStorage: keychain })).toBe("an-existing-key-000000000");
    });

    it("leaves the rest of the file alone", () => {
      const userDataDir = tempDir();
      fs.writeFileSync(
        plainFile(userDataDir),
        `SOMETHING_ELSE=keep-me\n${KEY_NAME}=an-existing-key-000000000\n`
      );

      sealExistingKey({ userDataDir, safeStorage: keychain });

      const left = fs.readFileSync(plainFile(userDataDir), "utf-8");
      expect(left).toContain("SOMETHING_ELSE=keep-me");
      expect(left).not.toContain("an-existing-key-000000000");
    });

    it("does nothing when there is nothing to move", () => {
      expect(sealExistingKey({ userDataDir: tempDir(), safeStorage: keychain })).toBeNull();
    });

    it("does nothing when there is nowhere to move it to", () => {
      const userDataDir = tempDir();
      fs.writeFileSync(plainFile(userDataDir), `${KEY_NAME}=an-existing-key-000000000\n`);

      expect(sealExistingKey({ userDataDir, safeStorage: noKeychain })).toBeNull();
      expect(readApiKey({ userDataDir })).toBe("an-existing-key-000000000");
    });
  });
});

// The environment used to win. It is inherited from whatever launched the app —
// a shell profile, an old export — and it beat the key the user had just typed
// into the prompt. The backend started with the stale one, Settings showed red,
// and re-entering the same key fixed it, which made the app look random.
describe("which key wins", () => {
  let dir;
  const before = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-which-"));
  });

  afterEach(() => {
    if (before === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = before;
  });

  it("prefers what the user stored in the app over the shell", () => {
    fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=typed-into-the-app\n");
    process.env.GEMINI_API_KEY = "stale-from-the-shell";

    expect(readApiKey({ userDataDir: dir, repoEnvPath: null, safeStorage: null })).toBe(
      "typed-into-the-app"
    );
  });

  it("still uses the environment when nothing is stored", () => {
    process.env.GEMINI_API_KEY = "from-the-shell";
    expect(readApiKey({ userDataDir: dir, repoEnvPath: null, safeStorage: null })).toBe(
      "from-the-shell"
    );
  });

  it("prefers the sealed copy over the plain one", () => {
    fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=plain\n");
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from(v),
      decryptString: (b) => b.toString(),
    };
    fs.writeFileSync(path.join(dir, "gemini-key.enc"), Buffer.from("sealed"));

    expect(readApiKey({ userDataDir: dir, repoEnvPath: null, safeStorage })).toBe("sealed");
  });

  it("has nothing to offer when there is nothing anywhere", () => {
    delete process.env.GEMINI_API_KEY;
    expect(readApiKey({ userDataDir: dir, repoEnvPath: null, safeStorage: null })).toBeNull();
  });
});
