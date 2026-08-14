const fs = require("fs");
const path = require("path");

// A packaged app cannot write into itself: everything inside the .app is read
// only and, on macOS, signed. So the key the user types goes to the per-user
// application support directory, which is also the right place for it — it is
// their credential rather than part of the program.
//
// backend/.env is still read when it is there, so a developer who already has
// the repo set up is never asked for a key they have already provided.

const KEY_NAME = "GEMINI_API_KEY";

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

// in order of how deliberate each one is: the environment beats the file the
// app wrote, which beats the repo's own
function readApiKey({ userDataDir, repoEnvPath }) {
  const fromEnv = process.env[KEY_NAME];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const fromUser = readEnvFile(userEnvPath(userDataDir))[KEY_NAME];
  if (fromUser) return fromUser;

  const fromRepo = repoEnvPath ? readEnvFile(repoEnvPath)[KEY_NAME] : undefined;
  return fromRepo || null;
}

// rewrites just this one line, so anything else in the file survives
function writeApiKey({ userDataDir }, key) {
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

module.exports = { readApiKey, writeApiKey, looksLikeKey, userEnvPath, KEY_NAME };
