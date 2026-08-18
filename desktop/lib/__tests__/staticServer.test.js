const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { startStaticServer } = require("../staticServer");

// The workspace lives in localStorage, and localStorage is keyed by origin. The
// app used to be served on whatever port the OS handed out, so every launch was
// a new origin and therefore an empty workspace — no tabs, no variables, no
// scanned project, no saved token. Everything the app persisted was written to
// an address it would never visit again.
describe("the origin the app is served from", () => {
  let dir;
  const opened = [];

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-static-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html>hi</html>");
  });

  afterEach(async () => {
    while (opened.length) await opened.pop().close();
  });

  it("comes up on the same address twice running", async () => {
    const first = await startStaticServer(dir);
    const url = first.url;
    await first.close();

    const second = await startStaticServer(dir);
    opened.push(second);
    // this is the whole point: a different url here means an empty workspace
    expect(second.url).toBe(url);
  });

  it("still starts when its port is taken, rather than failing to open", async () => {
    const first = await startStaticServer(dir);
    opened.push(first);

    const second = await startStaticServer(dir);
    opened.push(second);

    expect(second.url).toMatch(/^http:\/\/localhost:\d+$/);
    // and it says so, because otherwise it looks like the app forgot everything
    expect(second.url).not.toBe(first.url);
  });

  it("serves the export it was pointed at", async () => {
    const server = await startStaticServer(dir);
    opened.push(server);
    const body = await new Promise((resolve, reject) => {
      require("http")
        .get(`${server.url}/index.html`, (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve(text));
        })
        .on("error", reject);
    });
    expect(body).toContain("hi");
  });
});
