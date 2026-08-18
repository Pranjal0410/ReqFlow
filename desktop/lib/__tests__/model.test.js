const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const {
  catalogue,
  findModel,
  modelFile,
  partFile,
  readChoice,
  writeChoice,
  resolveModelPath,
  modelState,
  download,
  attemptDownload,
  looksLikeGguf,
  DEFAULT_MODEL_ID,
} = require("../model");

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-model-"));
}

// the four bytes a real .gguf starts with
function writeGguf(file, body = "weights") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from("GGUF"), Buffer.from(body)]));
}

describe("catalogue", () => {
  // the point of running locally is to stop waiting on a round trip, and a 14B
  // model on a laptop that is also running the project under test can be slower
  // than the call it replaced. so the small one leads.
  it("offers the small model first", () => {
    expect(catalogue()[0].id).toBe(DEFAULT_MODEL_ID);
    expect(catalogue()[0].approxBytes).toBeLessThan(catalogue()[1].approxBytes);
  });

  it("gives every entry somewhere to download from and somewhere to land", () => {
    for (const model of catalogue()) {
      expect(model.url).toMatch(/^https:\/\//);
      expect(model.file).toMatch(/\.gguf$/);
    }
  });

  it("hands out copies, so a caller cannot edit the catalogue", () => {
    catalogue()[0].label = "changed";
    expect(catalogue()[0].label).not.toBe("changed");
  });
});

describe("looksLikeGguf", () => {
  // the likeliest wrong file is an html error page saved under the right name,
  // and finding that out at the first scan is finding it out too late
  it("tells a model from an error page", () => {
    const dir = tempUserData();
    const real = path.join(dir, "real.gguf");
    const fake = path.join(dir, "fake.gguf");
    writeGguf(real);
    fs.writeFileSync(fake, "<!doctype html><title>404</title>");

    expect(looksLikeGguf(real)).toBe(true);
    expect(looksLikeGguf(fake)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("says no rather than throwing for a file that is not there", () => {
    expect(looksLikeGguf("/nowhere/at/all.gguf")).toBe(false);
  });
});

describe("the stored choice", () => {
  it("survives a round trip", () => {
    const dir = tempUserData();
    writeChoice(dir, { kind: "catalogue", id: "phi-4-mini" });
    expect(readChoice(dir)).toEqual({ kind: "catalogue", id: "phi-4-mini" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads as nothing chosen when there is no file", () => {
    const dir = tempUserData();
    expect(readChoice(dir)).toBeNull();
    expect(resolveModelPath(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // a model chosen and then deleted must not be handed to the backend: it would
  // fail at the first scan against a path nobody remembers choosing
  it("resolves to nothing when the chosen file has gone", () => {
    const dir = tempUserData();
    writeChoice(dir, { kind: "catalogue", id: "phi-4-mini" });
    expect(resolveModelPath(dir)).toBeNull();

    writeGguf(modelFile(dir, "phi-4-mini"));
    expect(resolveModelPath(dir)).toBe(modelFile(dir, "phi-4-mini"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("follows a file the user chose themselves", () => {
    const dir = tempUserData();
    const mine = path.join(dir, "mine.gguf");
    writeGguf(mine);
    writeChoice(dir, { kind: "custom", path: mine });
    expect(resolveModelPath(dir)).toBe(mine);

    fs.rmSync(mine);
    expect(resolveModelPath(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // choosing the hosted model is an answer, not an absence of one: the launch
  // must not ask again every time
  it("treats the cloud as a real answer with no path", () => {
    const dir = tempUserData();
    writeChoice(dir, { kind: "cloud" });
    expect(readChoice(dir)).toEqual({ kind: "cloud" });
    expect(resolveModelPath(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("modelState", () => {
  it("reports a downloaded model as ready, with its size", () => {
    const dir = tempUserData();
    writeChoice(dir, { kind: "catalogue", id: "phi-4-mini" });
    writeGguf(modelFile(dir, "phi-4-mini"), "x".repeat(100));

    const state = modelState(dir);
    expect(state.ready).toBe(true);
    expect(state.bytes).toBe(104);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // so the offer can be "resume" rather than "download", and nobody is told to
  // fetch gigabytes they already have
  it("notices a half finished download", () => {
    const dir = tempUserData();
    writeChoice(dir, { kind: "catalogue", id: "phi-4-mini" });
    const target = modelFile(dir, "phi-4-mini");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(partFile(target), "half a model");

    const state = modelState(dir);
    expect(state.ready).toBe(false);
    expect(state.partial).toBe(12);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // an html error page under the right name passes "the file is there" and
  // fails everything after it
  it("does not call a file that is not a model ready", () => {
    const dir = tempUserData();
    writeChoice(dir, { kind: "catalogue", id: "phi-4-mini" });
    const target = modelFile(dir, "phi-4-mini");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "<!doctype html>");

    expect(modelState(dir).ready).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// The download is tested over plain http against a server here rather than
// against huggingface: what is being checked is the resume and the atomic
// rename, and neither needs gigabytes or a network.
describe("download", () => {
  let server;
  let base;
  let served;

  beforeEach(async () => {
    served = Buffer.concat([Buffer.from("GGUF"), Buffer.from("0123456789")]);
    server = http.createServer((req, res) => {
      const range = req.headers.range;
      if (range) {
        const from = Number(/bytes=(\d+)-/.exec(range)[1]);
        if (from >= served.length) {
          res.writeHead(416);
          return res.end();
        }
        res.writeHead(206, { "content-length": served.length - from });
        return res.end(served.subarray(from));
      }
      res.writeHead(200, { "content-length": served.length });
      res.end(served);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/model.gguf`;
  });

  afterEach(() => server?.close());

  // https.get is what model.js uses, so the http server here needs the module
  // swapped. done by pointing the same function at http, which is the only
  // difference between the two for this purpose.
  const httpDownload = (...args) => {
    const https = require("https");
    const real = https.get;
    https.get = http.get;
    return download(...args).finally(() => {
      https.get = real;
    });
  };

  it("writes the whole file and gives it its real name only at the end", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");

    const result = await httpDownload(base, target);
    expect(fs.readFileSync(target)).toEqual(served);
    expect(fs.existsSync(partFile(target))).toBe(false);
    expect(result.bytes).toBe(served.length);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // a few gigabytes over a hotel connection will be interrupted, and starting
  // from zero each time is how a download never finishes
  it("carries on from what is already on disk", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");
    fs.writeFileSync(partFile(target), served.subarray(0, 6));

    const result = await httpDownload(base, target);
    expect(result.resumed).toBe(true);
    expect(fs.readFileSync(target)).toEqual(served);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats a complete part file as the finished download", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");
    fs.writeFileSync(partFile(target), served);

    await httpDownload(base, target);
    expect(fs.readFileSync(target)).toEqual(served);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // the part file is what makes the next attempt a resume, so a failure must
  // leave it alone rather than tidying it away
  it("keeps what it had when it is cancelled", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");
    const aborter = new AbortController();

    const started = httpDownload(base, target, { signal: aborter.signal });
    aborter.abort();
    await expect(started).rejects.toThrow(/cancelled/);
    expect(fs.existsSync(target)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Fetching 2.5GB from a CDN dropped twice in a row on an ordinary connection
// while this was being built, at 75% and again at 90%. Keeping the bytes but
// making the user press resume each time is a worse version of having no resume.
describe("download retries", () => {
  let server;
  let base;
  let served;
  let attempts;

  beforeEach(async () => {
    served = Buffer.concat([Buffer.from("GGUF"), Buffer.from("0123456789")]);
    attempts = 0;
    server = http.createServer((req, res) => {
      attempts++;
      const from = req.headers.range ? Number(/bytes=(\d+)-/.exec(req.headers.range)[1]) : 0;

      // The first two attempts drop halfway. The delay before destroying is
      // what makes this a real connection drop rather than a refused request:
      // the bytes reach the client, and then the pipe breaks. Without it the
      // client sees a socket hang up and nothing is written, which is a
      // different failure from the one this is about.
      if (attempts <= 2) {
        res.writeHead(from > 0 ? 206 : 200, { "content-length": served.length - from });
        res.write(served.subarray(from, from + 3));
        return setTimeout(() => res.destroy(), 60);
      }

      res.writeHead(from > 0 ? 206 : 200, { "content-length": served.length - from });
      res.end(served.subarray(from));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/model.gguf`;
  });

  afterEach(() => server?.close());

  const httpDownload = (...args) => {
    const https = require("https");
    const real = https.get;
    https.get = http.get;
    return download(...args).finally(() => {
      https.get = real;
    });
  };

  it("carries on through dropped connections and keeps the bytes", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");
    const retries = [];

    const result = await httpDownload(base, target, {
      onRetry: (info) => retries.push(info.attempt),
    });

    // two drops, so two retries, and the third attempt asked for a range rather
    // than starting over — which is the whole point: the bytes already fetched
    // survived the break
    expect(retries).toEqual([1, 2]);
    expect(result.resumed).toBe(true);
    expect(fs.readFileSync(target)).toEqual(served);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // a cancel is the user's decision, and retrying past it would carry on
  // downloading gigabytes they just said they did not want
  it("does not retry past a cancel", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");
    const aborter = new AbortController();

    const started = httpDownload(base, target, { signal: aborter.signal });
    aborter.abort();
    await expect(started).rejects.toThrow(/cancelled/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("gives up rather than retrying forever", async () => {
    const dir = tempUserData();
    const target = path.join(dir, "m.gguf");
    server.close();

    await expect(httpDownload(base, target, { retries: 1 })).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);
});

describe("findModel", () => {
  it("answers with nothing for a name that is not in the catalogue", () => {
    expect(findModel("gpt-9")).toBeNull();
    expect(modelFile(tempUserData(), "gpt-9")).toBeNull();
  });
});
