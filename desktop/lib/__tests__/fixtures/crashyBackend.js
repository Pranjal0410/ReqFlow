// A backend that answers as ReqFlow does, and dies when asked to. GET /crash
// is how the tests stand in for a server that falls over on its own.
const http = require("http");

http
  .createServer((req, res) => {
    if (req.url === "/crash") {
      res.end("dying");
      console.log("crashing on request");
      return process.exit(1);
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "running", app: "reqflow", version: "test" }));
  })
  .listen(4000, "127.0.0.1", () => console.log(`backend up as pid ${process.pid}`));
