// A backend from before the health endpoint named itself. Forked by the tests
// as a stand-in for what a shell meets when it is newer than the backend that
// was staged alongside it.
const http = require("http");

http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "running", timestamp: new Date().toISOString() }));
  })
  .listen(4000, "127.0.0.1", () => console.log("old backend listening"));
