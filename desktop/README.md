# ReqFlow desktop

ReqFlow as a double-clickable Mac app. Electron is a wrapper and nothing else:
the Express backend is the same server `npm run dev` starts, and the window
shows the same web build Expo produces. Neither one knows it is being hosted,
and both still run on their own exactly as before.

## Running it

```bash
cd desktop
npm install
npm run start
```

`start` builds whichever of the two halves is missing, then opens the app. On a
fresh checkout the first run takes about a minute, almost all of it the Expo
web export; after that it is a couple of seconds.

## Building a .dmg

```bash
npm run build
```

That compiles the backend, stages its production dependencies, exports the web
build, and hands the lot to electron-builder. The disk image lands in
`desktop/build/`.

## How it fits together

**The backend runs as a child process** on port 4000, spawned with
`ELECTRON_RUN_AS_NODE` so Electron's own binary acts as Node — a packaged app
cannot rely on a system Node being installed. Closing the window stops it:
leaving it running would hold port 4000 and the next launch would silently talk
to a server the user thought they had closed.

If something is *already* answering on 4000 when the app starts, that server is
adopted rather than replaced, and is left running on quit. That is almost always
your own `npm run dev`, and killing it would be taking down something this app
did not start.

**The frontend is served over http**, not loaded from `file://`. The Expo export
references its bundle as `/_expo/static/js/...`, an absolute path, which under
`file://` resolves against the filesystem root and renders a blank window. A
small static server on a free port fixes that, and has a second effect worth
having: the renderer gets a real hostname, so
`frontend/src/config.ts` — which already derives the API host from
`window.location.hostname` on web — points at `localhost:4000` without being
changed. The `DEV_IP` in that file is still only used by the native builds.

**The Gemini key** is read from the environment, then from
`~/Library/Application Support/reqflow-desktop/.env`, then from `backend/.env`.
The last of those means a developer with the repo already set up is never asked
for a key they have already provided. If none of the three has one, the first
launch asks, and stores it in the second. It cannot be stored inside the app
itself: a packaged `.app` is read-only and, once signed, tamper-evident.

The prompt can be skipped. The request builder, the proxy, variables,
assertions and timing history all work without a key; only the project scan and
the AI agent need one.

## Layout

```
desktop/
  main.js              window, lifecycle, shutdown
  preload.js           the key prompt's only bridge; the app window gets none
  key-prompt.html      first-launch key entry
  lib/
    backend.js         spawn, health-poll, adopt, stop
    staticServer.js    serves frontend/dist over http
    apiKey.js          read and write the key
  scripts/
    build.js           backend compile, dependency staging, web export
    prepare.js         builds only what is missing, for npm run start
  build/               electron-builder output, not committed
  staging/             production-only copy of the backend, not committed
```

## Known limitations

- **macOS arm64 only** as configured. `package.json` targets a `dmg` for
  `arm64`; an Intel or Windows build means adding targets there.
- **Unsigned.** Without an Apple Developer certificate the app is ad-hoc signed,
  so the first open needs right-click → Open, or Gatekeeper will refuse it.
  Distributing it properly means signing and notarising.
- **Port 4000 is fixed**, because the frontend's config hardcodes it too.
  If another program holds it and is not ReqFlow, the app says so and exits
  rather than starting half-working.
- **The window is a browser**, so DevTools, zoom and text selection behave the
  way they do on the web, not the way a native Mac app would.
