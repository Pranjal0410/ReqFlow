const http = require("http");
const net = require("net");
const { inspectPort, Backend, PORT } = require("../backend");

// These bind the real port, because what is being tested is a decision made
// about that port from the outside, and a fake would only prove the fake works.
function serve(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const close = (server) => new Promise((resolve) => server.close(resolve));

function portIsFree() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(PORT, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

let servers = [];
const track = async (handler) => {
  const server = await serve(handler);
  servers.push(server);
  return server;
};

beforeAll(async () => {
  if (!(await portIsFree())) {
    throw new Error(
      `port ${PORT} is in use, so these tests cannot bind it. Stop whatever is listening and run them again.`
    );
  }
});

afterEach(async () => {
  await Promise.all(servers.map(close));
  servers = [];
});

const reqflowHealth = (_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: "running", app: "reqflow", version: "1.0.0" }));
};

describe("inspectPort", () => {
  it("calls an empty port free", async () => {
    expect(await inspectPort()).toBe("free");
  });

  it("recognises our own backend by name", async () => {
    await track(reqflowHealth);
    expect(await inspectPort()).toBe("reqflow");
  });

  // The check this replaced looked for status 200, and later for status: "ok".
  // Half the servers a developer has running answer one or the other, and
  // adopting one means every request the user makes goes somewhere they did not
  // choose, quietly. So the name is the test, and nothing else is.
  it("does not adopt a stranger that merely answers", async () => {
    await track((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
    });
    expect(await inspectPort()).toBe("stranger");
  });

  it("does not adopt a server that answers with something other than json", async () => {
    await track((_req, res) => res.end("<html>a dev server</html>"));
    expect(await inspectPort()).toBe("stranger");
  });

  it("treats a 404 as a stranger rather than an empty port", async () => {
    await track((_req, res) => {
      res.statusCode = 404;
      res.end("nope");
    });
    expect(await inspectPort()).toBe("stranger");
  });

  it("treats a port that holds the socket without answering as occupied", async () => {
    await track(() => {});
    expect(await inspectPort(500)).toBe("silent");
  });

  // A probe used to reuse its pooled connection, and a pooled socket to a
  // server that has since stopped fails with a reset rather than a refusal,
  // which read as "free" and sent the launch off to spawn a backend that could
  // not bind. Two probes either side of a restart is exactly that sequence.
  it("is not fooled by a connection left over from the last probe", async () => {
    const first = await track(reqflowHealth);
    expect(await inspectPort()).toBe("reqflow");
    await close(first);
    servers = servers.filter((s) => s !== first);

    expect(await inspectPort()).toBe("free");

    await track(reqflowHealth);
    expect(await inspectPort()).toBe("reqflow");
  });
});

// Waiting for our own child to come up is a different question from deciding
// whether to adopt a server we did not start, and it was briefly asked with the
// same check. A packaged app whose staged backend predates the name in the
// health answer then spent twenty seconds waiting for a server that was already
// running, and put up "ReqFlow's backend would not start" over the top of it.
describe("Backend.start with a backend older than the shell", () => {
  const oldBackend = require.resolve("./fixtures/oldBackend.js");

  it("waits for the child it spawned, not for a name the child may not know", async () => {
    const backend = new Backend();
    const started = Date.now();

    await expect(
      backend.start({ entry: oldBackend, cwd: __dirname })
    ).resolves.toEqual({ adopted: false });

    // the point is that it did not sit out the twenty second timeout
    expect(Date.now() - started).toBeLessThan(5000);
    await backend.stop();
  }, 30_000);
});

// A backend that dies takes every request with it, and all the window can say
// is that port 4000 is not answering — which reads as ReqFlow being broken
// rather than as a server that stopped and is coming back.
describe("when the backend dies on its own", () => {
  const crashy = require.resolve("./fixtures/crashyBackend.js");

  const crash = () =>
    new Promise((resolve) => {
      http
        .get("http://127.0.0.1:4000/crash", (res) => {
          res.resume();
          res.on("end", resolve);
        })
        .on("error", resolve);
    });

  const settle = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await inspectPort(500).then((h) => h === "reqflow")) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  it("brings it back, without the window having to be reopened", async () => {
    const backend = new Backend();
    await backend.start({ entry: crashy, cwd: __dirname });
    const first = backend.child.pid;

    await crash();

    expect(await settle(10_000)).toBe(true);
    expect(backend.child.pid).not.toBe(first);
    await backend.stop();
  }, 30_000);

  it("stops trying, and says so, when it will not stay up", async () => {
    const backend = new Backend();
    const gaveUp = jest.fn();
    await backend.start({ entry: crashy, cwd: __dirname, onGiveUp: gaveUp });

    // one more than it is willing to restart
    for (let i = 0; i < 4; i++) {
      await crash();
      await settle(10_000);
    }

    expect(gaveUp).toHaveBeenCalledTimes(1);
    expect(gaveUp.mock.calls[0][0]).toMatch(/stopped 4 times/);
    await backend.stop();
    expect(await inspectPort()).toBe("free");
  }, 60_000);

  // Quitting kills the child on purpose, and a restart on the way out would
  // leave a server running with no window attached to it — which is the state
  // that makes the next launch find port 4000 taken.
  it("does not restart the child that the quit killed", async () => {
    const backend = new Backend();
    await backend.start({ entry: crashy, cwd: __dirname });

    await backend.stop();
    await new Promise((r) => setTimeout(r, 1500));

    expect(await inspectPort()).toBe("free");
    expect(backend.child).toBe(null);
  }, 30_000);
});

describe("Backend.start with something else on the port", () => {
  const entry = require.resolve("./backend.test.js"); // never reached

  it("asks before doing anything, and quits when told to", async () => {
    await track((_req, res) => res.end("not reqflow"));
    const backend = new Backend();
    const onConflict = jest.fn().mockResolvedValue(false);

    await expect(backend.start({ entry, cwd: __dirname, onConflict })).rejects.toMatchObject({
      code: "PORT_CONFLICT",
    });
    expect(onConflict).toHaveBeenCalledTimes(1);
    // nothing was spawned, so there is nothing left running afterwards
    expect(backend.child).toBe(null);
  });

  it("does not ask when the port is ours, and adopts it instead", async () => {
    await track(reqflowHealth);
    const backend = new Backend();
    const onConflict = jest.fn();

    await expect(backend.start({ entry, cwd: __dirname, onConflict })).resolves.toEqual({
      adopted: true,
    });
    expect(onConflict).not.toHaveBeenCalled();
  });

  // Adopting means the server belongs to someone else — the developer's own
  // npm run dev, usually — and quitting ReqFlow must not take it down.
  it("leaves an adopted server running when it stops", async () => {
    await track(reqflowHealth);
    const backend = new Backend();
    await backend.start({ entry, cwd: __dirname });
    await backend.stop();

    expect(await inspectPort()).toBe("reqflow");
  });
});
