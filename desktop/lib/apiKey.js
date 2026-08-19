const fs = require("fs");
const path = require("path");

// A packaged app cannot write into itself: everything inside the .app is read
// only and, on macOS, signed. So the key the user types goes to the per-user
// application support directory, which is also the right place for it — it is
// their credential rather than part of the program.
//
// backend/.env is still read when it is there, so a developer who already has
// the repo set up is never asked for a key they have already provided.

// The key used to sit in that file in plain text, which is readable by anything
// running as this user. macOS, Windows and Linux all have a keychain for
// exactly this, and Electron's safeStorage is the one interface to all three,
// so the key is encrypted with it and the ciphertext is what lands on disk.
//
// safeStorage is passed in rather than required, so this file stays testable
// outside Electron — and so a Linux session with no keyring available can fall
// back to the plain file rather than losing the ability to store a key at all.

const KEY_NAME = "GEMINI_API_KEY";

// not .env: nothing should try to parse this as text
const SEALED_FILE = "gemini-key.enc";

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function userEnvPath(userDataDir) {
  return path.join(userDataDir, ".env");
}

function sealedPath(userDataDir) {
  return path.join(userDataDir, SEALED_FILE);
}

// Every call here reaches the system keychain, and on macOS that call is
// synchronous: it does not return until the user has answered whatever the
// system decides to ask. Nothing else in the process runs in the meantime.
//
// So it is only ever asked when the answer is going to be used. Asking it in
// order to discover that there was nothing to decrypt is a prompt the user has
// to dismiss for no reason, in front of an app that has stopped responding
// while it waits.
function canSeal(safeStorage) {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readSealed(userDataDir, safeStorage) {
  // The file is checked first, deliberately. A fresh install has no sealed key,
  // and asking the keychain about a file that is not there was enough to park
  // the whole app on a first launch: the read blocked the main thread, the
  // window it had just created never got its own content, and the app showed
  // nothing until it was quit and reopened.
  if (!fs.existsSync(sealedPath(userDataDir))) return null;
  if (!canSeal(safeStorage)) return null;
  try {
    const sealed = fs.readFileSync(sealedPath(userDataDir));
    const key = safeStorage.decryptString(sealed).trim();
    return key || null;
  } catch {
    // no file, or one this machine's keychain cannot open — either way there
    // is no key here, and the caller has other places to look
    return null;
  }
}

// in order of how deliberate each one is: the environment beats the key the
// app stored, which beats the repo's own
// Where the key comes from, in the order of how deliberate each source is.
//
// The environment used to win. It is inherited from whatever launched the app —
// a shell profile, an old export, a terminal opened weeks ago — and it beat the
// key the user had just typed into the prompt. The app then asked no questions,
// started the backend with the stale one, showed a red dot in Settings, and said
// the key was invalid. Re-entering the same key in Settings fixed it, which made
// the whole thing look random.
//
// So: what the user stored inside this app comes first, because storing it took
// a deliberate act here. The environment stays as a way to run without storing
// anything, which is what it is good for.
function readApiKey({ userDataDir, repoEnvPath, safeStorage }) {
  const sealed = readSealed(userDataDir, safeStorage);
  if (sealed) return sealed;

  const fromUser = readEnvFile(userEnvPath(userDataDir))[KEY_NAME];
  if (fromUser) return fromUser;

  const fromEnv = process.env[KEY_NAME];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const fromRepo = repoEnvPath ? readEnvFile(repoEnvPath)[KEY_NAME] : undefined;
  return fromRepo || null;
}

// A key already sitting in the plain file is moved into the encrypted one and
// removed from it. Doing this on the first launch after the change means an
// existing install stops holding a readable credential without the user having
// to be asked for it again.
function sealExistingKey({ userDataDir, safeStorage }) {
  // the plain key is looked for before the keychain is, for the same reason:
  // there is nothing to seal on most launches, and finding that out should not
  // cost a system prompt
  const file = userEnvPath(userDataDir);
  const plain = readEnvFile(file)[KEY_NAME];
  if (!plain) return null;

  if (!canSeal(safeStorage)) return null;

  writeApiKey({ userDataDir, safeStorage }, plain);

  // take out the one line, leaving anything else in the file alone
  try {
    const rest = fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => !new RegExp(`^\\s*${KEY_NAME}\\s*=`).test(line))
      .join("\n")
      .replace(/^\n+/, "");
    if (rest.trim()) {
      fs.writeFileSync(file, rest, { mode: 0o600 });
    } else {
      fs.rmSync(file);
    }
  } catch (err) {
    // the key is safely stored either way; leaving the old copy is not worth
    // failing a launch over, though it is worth knowing about
    return { moved: true, removed: false, error: err.message };
  }

  return { moved: true, removed: true };
}

// rewrites just this one line, so anything else in the file survives
function writePlainApiKey({ userDataDir }, key) {
  const file = userEnvPath(userDataDir);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  const line = `${KEY_NAME}=${key.trim()}`;

  const next = new RegExp(`^\\s*${KEY_NAME}\\s*=.*$`, "m").test(existing)
    ? existing.replace(new RegExp(`^\\s*${KEY_NAME}\\s*=.*$`, "m"), line)
    : `${existing.replace(/\s*$/, "")}\n${line}\n`.trimStart();

  fs.mkdirSync(userDataDir, { recursive: true });
  // the file holds a credential, so it is not left world readable
  fs.writeFileSync(file, next, { mode: 0o600 });
  return file;
}

// Encrypted where the platform offers it, and in the plain file where it does
// not — a Linux session with no keyring is the case that has to keep working,
// since refusing to store the key there would mean asking for it every launch.
function writeApiKey({ userDataDir, safeStorage }, key) {
  if (!canSeal(safeStorage)) return writePlainApiKey({ userDataDir }, key);

  const file = sealedPath(userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(key.trim()), { mode: 0o600 });
  return file;
}

// Catch the paste mistakes, not the format. An earlier version of this required
// the key to start with AIza, which is the shape of the older Google API keys;
// the first real key it was tested against starts with AQ. and would have been
// refused. Rejecting a valid credential because its prefix is unfamiliar is
// worse than not checking at all, since there is no way for the user to argue
// with it.
//
// So only the things that are certainly not a key are refused: too short to be
// one, the whole KEY=value line pasted in, or a value with a space in it.
// Anything else goes through and, if wrong, comes back as an error from the
// model with the reason the model gave.
function looksLikeKey(value) {
  const trimmed = String(value || "").trim();

  if (trimmed.length < 20) return false;
  if (/\s/.test(trimmed)) return false;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) return false;
  return true;
}

module.exports = {
  readApiKey,
  writeApiKey,
  sealExistingKey,
  looksLikeKey,
  userEnvPath,
  sealedPath,
  KEY_NAME,
};
