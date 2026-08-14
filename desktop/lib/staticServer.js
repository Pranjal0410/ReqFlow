const http = require("http");
const fs = require("fs");
const path = require("path");

// The Expo web export references its bundle as /_expo/static/js/... — an
// absolute path. Under file:// that resolves against the filesystem root and
// the page loads blank, which is the usual way wrapping a web build in Electron
// goes wrong. Serving the same directory over http fixes the paths and, as a
// second effect, gives the renderer a real hostname. frontend/src/config.ts
// already derives the api host from window.location.hostname on web, so it
// points at localhost:4000 here without being told to.

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// a request for ../../etc/passwd is not a route, and the answer is 403 rather
// than whatever happens to be at that path
function resolveWithin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const full = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // the bundle name carries a hash, so a stale copy after an update is not a
    // thing that can happen. the html must not be cached or it would keep
    // pointing at the previous bundle.
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function startStaticServer(root) {
  const base = path.resolve(root);

  const server = http.createServer((req, res) => {
    const target = resolveWithin(base, req.url === "/" ? "/index.html" : req.url);
    if (!target) return send(res, 403, "forbidden");

    fs.readFile(target, (err, data) => {
      if (!err) {
        return send(res, 200, data, MIME[path.extname(target).toLowerCase()] || "application/octet-stream");
      }

      // anything without a file extension is a route the app handles itself,
      // so it gets the shell rather than a 404
      if (!path.extname(target)) {
        return fs.readFile(path.join(base, "index.html"), (fallbackErr, html) =>
          fallbackErr ? send(res, 404, "not found") : send(res, 200, html, MIME[".html"])
        );
      }
      send(res, 404, "not found");
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    // port 0 asks the OS for a free one, so the app can never collide with
    // whatever else the developer has running
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://localhost:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { startStaticServer };
