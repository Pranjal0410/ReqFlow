const http = require("http");
const fs = require("fs");
const path = require("path");

// Fixed, so the app is always served from the same origin. localStorage is
// keyed by origin, and the workspace lives there.
const PORT = 4179;

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

  // The origin the app is served from, which is also the key the browser files
  // localStorage under.
  //
  // This used to ask the OS for any free port, so that the app could never
  // collide with whatever the developer was running. It could not — and it also
  // came up on a different origin every launch, which meant the workspace was
  // empty every time: no tabs, no variables, no scanned project, no saved
  // token. Everything the app takes care to persist was written to an address
  // it would never visit again. A fixed port keeps the origin stable, which is
  // what makes any of that survive.
  return listenOn(server, PORT).catch((err) => {
    if (err && err.code !== "EADDRINUSE") throw err;
    // Something else holds it. Falling back keeps the app working, at the cost
    // of this session starting from an empty workspace — said out loud rather
    // than left to look like the app forgetting things at random.
    console.warn(
      `[reqflow] port ${PORT} is taken, so this window gets a temporary address ` +
        `and will not see anything saved by earlier sessions.`
    );
    return listenOn(server, 0);
  });
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve({
        // The address it is actually on, not a name that usually resolves to
        // it. This bound to 127.0.0.1 and then called itself localhost, which
        // are the same thing right up until they are not: a machine whose
        // localhost resolves to ::1 first has nothing listening there, and the
        // window asks for its own content and never gets an answer. It cost a
        // CI job that hung rather than failed, and it is the same shape as an
        // app that opens to nothing.
        url: `http://127.0.0.1:${server.address().port}`,
        // the app is quitting: a browser tab holding a keep-alive socket must
        // not decide how long that takes
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(done);
          }),
      });
    });
  });
}

module.exports = { startStaticServer };
