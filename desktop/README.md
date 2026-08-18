# ReqFlow desktop

ReqFlow as a double-clickable app, on macOS, Windows and Linux. Electron is a
wrapper and nothing else:
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

### The other platforms

```bash
npm run build:win      # NSIS installer, x64
npm run build:linux    # AppImage, x64
```

Both can be built from a Mac: the staged backend is plain JavaScript with no
native modules in it, so the same files ship everywhere, and electron-builder
fetches the Windows and Linux Electron binaries itself. The Windows installer
needs wine, which electron-builder downloads on first use.

## Opening it the first time

The app is not signed by an Apple Developer account, so macOS will not open it
on a double click. The first open is:

1. Drag **ReqFlow** from the disk image into Applications.
2. **Right-click it → Open**, then **Open** again in the box that appears.

Double-clicking gives "ReqFlow can't be opened because Apple cannot check it for
malicious software" with no way past it. Right-click → Open offers the same
message *with* an Open button, and macOS remembers the decision — every launch
after the first is an ordinary double click.

If it was downloaded rather than built locally and macOS says the app is
**damaged**, that is quarantine plus an unsigned bundle rather than a real
corruption:

```bash
xattr -dr com.apple.quarantine /Applications/ReqFlow.app
```

The build ad-hoc signs the bundle (`scripts/adhocSign.js`) for this reason.
Electron's binary ships linker-signed, and leaving that alone produces a bundle
whose signature promises sealed resources it does not have — which macOS reads
as tampering, not as an unsigned app, and refuses outright rather than offering
the right-click way through.

## How it fits together

**The backend runs as a child process** on port 4000, spawned with
`ELECTRON_RUN_AS_NODE` so Electron's own binary acts as Node — a packaged app
cannot rely on a system Node being installed. Closing the window stops it:
leaving it running would hold port 4000 and the next launch would silently talk
to a server the user thought they had closed.

If something is *already* answering on 4000 when the app starts, the app asks it
who it is: `/health` returns `{ "status": "running", "app": "reqflow", ... }`,
and only that answer counts. A server that names itself is adopted rather than
replaced, and left running on quit — that is almost always your own
`npm run dev`, and killing it would be taking down something this app did not
start. Anything else holding the port is a stranger, and the app says so and
offers to quit rather than adopting it: a request the user thinks is going to
their project, going somewhere else, is worse than not starting.

**Only one copy runs at a time.** Opening ReqFlow while it is already open
raises the window that is there. Two windows cannot share one backend sensibly:
quitting either of them would take the server out from under the other.

**The frontend is served over http**, not loaded from `file://`. The Expo export
references its bundle as `/_expo/static/js/...`, an absolute path, which under
`file://` resolves against the filesystem root and renders a blank window. A
small static server on a free port fixes that, and has a second effect worth
having: the renderer gets a real hostname, so
`frontend/src/config.ts` — which already derives the API host from
`window.location.hostname` on web — points at `localhost:4000` without being
changed. The `DEV_IP` in that file is still only used by the native builds.

**If the backend dies it is restarted**, up to three times a minute, without
the window being told: to the page it is a few failed requests rather than a
session that has to be started again. Past that it stops trying and says so,
because a server that will not stay up is not something to keep hiding. Its
output goes to a log file either way — `backend.log`, with the previous run
kept alongside it as `backend.previous.log`, under:

```
macOS    ~/Library/Logs/reqflow-desktop/
Windows  %APPDATA%\reqflow-desktop\logs\
Linux    ~/.config/reqflow-desktop/logs/
```

A packaged app has no console to print to, so without that file a crash leaves
nothing behind to read.

**The Gemini key** is read from the environment, then from the encrypted store
the app writes, then from `backend/.env`. The last of those means a developer
with the repo already set up is never asked for a key they have already
provided. If none of the three has one, the first launch asks.

It is encrypted with Electron's `safeStorage`, which is the keychain on macOS,
DPAPI on Windows and the desktop keyring on Linux — so what lands on disk is
ciphertext rather than a credential any process running as this user could
read. A session with no keyring available (which happens on Linux) falls back
to a `.env` file with owner-only permissions, because refusing to store the key
at all would mean asking for it on every launch. An install that already had a
plain-text key has it moved into the encrypted store on the next launch, and
the plain copy removed.

The key cannot be stored inside the app itself: a packaged `.app` is read-only
and, once signed, tamper-evident.

The prompt can be skipped. The request builder, the proxy, variables,
assertions and timing history all work without a key; only the project scan and
the AI agent need one.

## Layout

```
desktop/
  main.js              window, lifecycle, shutdown
  preload.js           the key prompt's only bridge; the app window gets none
  key-prompt.html      first-launch key entry
  model-prompt.html    first-launch engine choice and download progress
  lib/
    backend.js         spawn, health-poll, adopt, restart, stop
    staticServer.js    serves frontend/dist over http
    apiKey.js          read and write the key, encrypted where it can be
    model.js           the local model: catalogue, resumable download, choice
  scripts/
    build.js           backend compile, dependency staging, web export
    prepare.js         builds only what is missing, for npm run start
    adhocSign.js       ad-hoc signs the packaged app, so macOS calls it
                       unsigned rather than damaged
  build/               electron-builder output, not committed
  staging/             production-only copy of the backend, not committed
```

## The model that runs here

This is the reason ReqFlow is a desktop app rather than only a web page: the
model can live where the code does. The backend loads the weights into its own
process through llama.cpp, so there is no daemon to install, no second program to
keep alive and no port to defend. Generating an endpoint, once the weights are
there, involves no network at all.

The first launch asks where the model should run before it asks for an API key,
because the answer decides whether a key is needed at all. Someone who runs the
model here is never asked for a credential they will never use.

**Nothing downloads on its own.** The window shows what it is about to fetch and
how big it is, and the download only starts from a button. It is resumable: the
bytes go to a `.part` file and only take the model's real name once the whole
thing has arrived, so an interrupted download is something to carry on with
rather than start again, and a truncated file is never loaded as a model.

What arrives is checked for the four bytes a `.gguf` begins with. The likeliest
wrong file is an HTML error page saved under the right name, and finding that out
at the first scan is finding it out too late to say anything useful.

Choices are kept in `model.json` in the user data directory, next to the
encrypted key — it names a model rather than holding a secret, so it is a plain
file. Deleting it makes the next launch ask again. A model that was chosen and
has since gone missing, deleted or on a drive that is not plugged in, is asked
about again rather than handed to the backend to fail on.

```
~/Library/Application Support/ReqFlow/
  model.json                    which engine, and which model
  models/*.gguf                 the weights, once downloaded
  gemini-key.enc                the key, if one was given
```

## Known limitations

- **Only the Mac build is signed at all**, ad-hoc. The Windows installer is
  unsigned too, so SmartScreen shows "Windows protected your PC" and needs
  More info → Run anyway.
- **Unsigned.** The app is ad-hoc signed, which is enough to be opened by
  right-click → Open but not enough to be opened by a double click, and it will
  never be until it is signed with an Apple Developer certificate and notarised.
  See "Opening it the first time" above.
- **Port 4000 is fixed**, because the frontend's config hardcodes it too.
  If another program holds it and is not ReqFlow, the app says so and offers to
  quit rather than starting half-working.
- **The window is a browser**, so DevTools, zoom and text selection behave the
  way they do on the web, not the way a native Mac app would.
- **The local model makes the app much larger.** llama.cpp ships as a native
  binary per platform, and the weights are gigabytes on top of that. The
  installer stays small — the weights are fetched on first launch, not built in —
  but the disk they end up on is the user's.
- **A local scan is slower than a hosted one**, and a large project is a minute
  of work rather than a few seconds. It also runs in batches, because a laptop's
  context will not hold a whole project the way a hosted model's does.
