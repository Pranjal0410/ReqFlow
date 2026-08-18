const fs = require("fs");
const path = require("path");
const https = require("https");

// The weights the local model runs from. They are not shipped inside the app:
// gigabytes do not belong in a repository or a .dmg, and the licence is the
// model's rather than ours to redistribute. So the app fetches them once, into
// the per-user data directory, and every interaction after that is local.
//
// Downloading gigabytes without asking is not something an app should do on
// first launch, so nothing here starts on its own. main.js asks; this does the
// work once the answer is yes.

// No vendor was asked for, so these are chosen on merit and should be re-chosen
// whenever the evidence changes. What the choice is actually made on:
//
//   Decode speed here is memory-bandwidth-bound, so a smaller model is a faster
//   one, and the memory is shared with Electron, the bundler and the project
//   under test. A model that is better in the abstract but swaps on the user's
//   laptop is a worse product, and a 14B at ~9GB does exactly that on 16GB.
//
//   The task is narrow — write one handler in the style of a file that is right
//   there — which is what code-specialised models are trained for. Being good at
//   general reasoning does not transfer to it as well as being good at code.
const CATALOGUE = [
  {
    id: "phi-4-mini",
    label: "Phi-4-mini",
    parameters: "3.8B",
    // measured from the file itself once downloaded; this is the published
    // figure, used only to tell the user what they are about to fetch
    approxBytes: 2_490_000_000,
    file: "phi-4-mini-instruct-q4.gguf",
    url: "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
    note: "Runs comfortably next to your own dev server. The default.",
  },
  {
    id: "phi-4",
    label: "Phi-4",
    parameters: "14B",
    approxBytes: 9_050_000_000,
    file: "phi-4-q4.gguf",
    url: "https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf",
    note: "Better code, about 10GB of memory while it runs.",
  },
];

const DEFAULT_MODEL_ID = "phi-4-mini";

function catalogue() {
  return CATALOGUE.map((m) => ({ ...m }));
}

function findModel(id) {
  return CATALOGUE.find((m) => m.id === id) || null;
}

function modelsDir(userDataDir) {
  return path.join(userDataDir, "models");
}

// Where a catalogue model lives once fetched. A file the user chose themselves
// is stored as a path instead, and is not managed here.
function modelFile(userDataDir, id) {
  const model = findModel(id);
  return model ? path.join(modelsDir(userDataDir), model.file) : null;
}

const CHOICE_FILE = "model.json";

function choicePath(userDataDir) {
  return path.join(userDataDir, CHOICE_FILE);
}

// What the user picked: one of ours, a file of their own, or the cloud. Kept as
// a plain file rather than in the keychain — it names a model, not a secret.
function readChoice(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(choicePath(userDataDir), "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeChoice(userDataDir, choice) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(choicePath(userDataDir), JSON.stringify(choice, null, 2));
  return choicePath(userDataDir);
}

// The path the backend should load, or null when there is nothing to load. A
// choice pointing at a file that has since been deleted counts as nothing:
// starting the backend against it would fail at the first request instead of
// here, where it can still be fixed.
function resolveModelPath(userDataDir) {
  const choice = readChoice(userDataDir);
  if (!choice) return null;

  if (choice.kind === "custom") {
    return choice.path && fs.existsSync(choice.path) ? choice.path : null;
  }
  if (choice.kind === "catalogue") {
    const file = modelFile(userDataDir, choice.id);
    return file && fs.existsSync(file) ? file : null;
  }
  return null;
}

// A partial file from an interrupted download. Kept under its own name so a
// half-written model is never mistaken for a finished one — the rename at the
// end is what makes the real file appear, and it is atomic.
const PART_SUFFIX = ".part";

function partFile(target) {
  return `${target}${PART_SUFFIX}`;
}

function bytesOnDisk(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// One attempt. Resumed with a Range header from whatever is already on disk, so
// a few gigabytes over a connection that drops does not start from zero.
function attemptDownload(url, target, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const part = partFile(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const from = bytesOnDisk(part);
    const headers = from > 0 ? { Range: `bytes=${from}-` } : {};

    // Cancelling has to work during the connection too, not only once bytes are
    // arriving. Attached before the request rather than inside the response
    // handler, where pressing Cancel while the server was still thinking about
    // it did nothing at all and the download carried on to the end.
    if (signal?.aborted) return reject(new Error("cancelled"));

    let settled = false;
    const teardown = [];
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      for (const undo of teardown) undo();
      fn(value);
    };

    const request = https.get(url, { headers }, (res) => {
      // huggingface answers with a redirect to a CDN, more than once
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return attemptDownload(res.headers.location, target, { onProgress, signal }).then(
          (value) => finish(resolve, value),
          (err) => finish(reject, err)
        );
      }

      if (res.statusCode === 416) {
        // the server says there is nothing after what we already have, which
        // means the part file is the whole file
        res.resume();
        fs.renameSync(part, target);
        return finish(resolve, { path: target, bytes: bytesOnDisk(target), resumed: true });
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return finish(reject, new Error(`the download answered ${res.statusCode}`));
      }

      // 200 to a ranged request means the server ignored the range and is
      // sending the whole thing, so what is on disk has to go rather than be
      // appended to
      const appending = res.statusCode === 206 && from > 0;
      if (!appending && from > 0) fs.rmSync(part, { force: true });

      const already = appending ? from : 0;
      const declared = Number(res.headers["content-length"]) || 0;
      const total = declared ? already + declared : 0;

      const out = fs.createWriteStream(part, { flags: appending ? "a" : "w" });
      let received = already;

      // The part file is deliberately left where it is: it is what makes the
      // next attempt a resume rather than a restart. It is ended rather than
      // destroyed, because destroying throws away whatever is still buffered —
      // bytes that arrived and would otherwise have to be fetched again.
      // finish() runs first so it marks the attempt settled, which is what stops
      // the "finish" handler below renaming a half written file into place.
      const fail = (err) => {
        res.destroy();
        finish(reject, err);
        out.end();
      };
      teardown.push(() => {
        res.destroy();
        out.end();
      });

      res.on("data", (chunk) => {
        received += chunk.length;
        onProgress?.({ received, total });
      });
      res.on("error", fail);
      out.on("error", fail);

      res.pipe(out);
      out.on("finish", () => {
        // a cancel that landed while the last chunk was being written must not
        // then be rewarded with a finished model
        if (settled || signal?.aborted) return;
        // Only now does the file take its real name. Anything that goes wrong
        // before this leaves a .part behind, never a truncated model that the
        // next launch would load and fail on in a way nobody could read.
        try {
          fs.renameSync(part, target);
          finish(resolve, { path: target, bytes: bytesOnDisk(target), resumed: already > 0 });
        } catch (err) {
          finish(reject, err);
        }
      });
    });

    if (signal) {
      const onAbort = () => {
        request.destroy();
        finish(reject, new Error("cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      teardown.push(() => signal.removeEventListener("abort", onAbort));
    }

    request.on("error", (err) => finish(reject, err));
  });
}

// Connection resets happen. Fetching 2.5GB from a CDN dropped twice in a row on
// an ordinary connection while this was being tested, at 75% and again at 90%.
// Without this the user presses resume each time, which is a worse version of
// having no resume at all — the bytes were kept, but the waiting was manual.
const TRANSIENT = /ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|aborted|network/i;

const MAX_RETRIES = 8;

// Each attempt resumes from the part file, and the original url is used again
// rather than the CDN address it redirected to last time, because those expire.
async function download(url, target, { onProgress, signal, retries = MAX_RETRIES, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptDownload(url, target, { onProgress, signal });
    } catch (err) {
      // a cancel is the user's decision and is never retried past
      if (signal?.aborted || err.message === "cancelled") throw err;
      if (attempt >= retries || !TRANSIENT.test(err.message)) throw err;

      onRetry?.({ attempt: attempt + 1, of: retries, error: err.message });
      // backing off rather than hammering: a network that just dropped is
      // usually still dropping a second later
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15_000)));
    }
  }
}

// A .gguf begins with those four bytes. Checked because the most likely wrong
// file is an HTML error page saved under the right name, and finding that out
// at the first scan is finding it out too late to say anything useful.
function looksLikeGguf(file) {
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    return head.toString("ascii") === "GGUF";
  } catch {
    return false;
  }
}

// What the app knows about the local model right now, without loading it.
// Loading is the backend's job and costs seconds; this is what the launch needs
// in order to decide whether there is anything to load at all.
function modelState(userDataDir) {
  const choice = readChoice(userDataDir);
  const resolved = resolveModelPath(userDataDir);

  return {
    choice,
    path: resolved,
    ready: !!resolved && looksLikeGguf(resolved),
    bytes: resolved ? bytesOnDisk(resolved) : 0,
    // a download that was interrupted, so the offer can be "resume" rather than
    // "download" and the user is not told to start over
    partial: (() => {
      if (!choice || choice.kind !== "catalogue") return 0;
      const file = modelFile(userDataDir, choice.id);
      return file ? bytesOnDisk(partFile(file)) : 0;
    })(),
  };
}

module.exports = {
  catalogue,
  findModel,
  modelsDir,
  modelFile,
  readChoice,
  writeChoice,
  resolveModelPath,
  modelState,
  download,
  attemptDownload,
  looksLikeGguf,
  partFile,
  DEFAULT_MODEL_ID,
  CATALOGUE,
};
