const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");

const { startStaticServer } = require("./lib/staticServer");
const { Backend, PORT } = require("./lib/backend");
const { readApiKey, writeApiKey, looksLikeKey, userEnvPath } = require("./lib/apiKey");

// ReqFlow as a double-clickable app. Electron is a wrapper and nothing more:
// the Express server is the same one npm run dev starts, and the window shows
// the same web build expo produces. Neither knows it is being hosted.

// Packaged, the two builds sit in Contents/Resources. Unpackaged, they are
// where they always were, so npm run start works against a checkout.
const RESOURCES = app.isPackaged
  ? {
      backendEntry: path.join(process.resourcesPath, "backend", "dist", "index.js"),
      backendCwd: path.join(process.resourcesPath, "backend"),
      frontendDir: path.join(process.resourcesPath, "frontend"),
      repoEnv: null,
    }
  : {
      backendEntry: path.join(__dirname, "..", "backend", "dist", "index.js"),
      backendCwd: path.join(__dirname, "..", "backend"),
      frontendDir: path.join(__dirname, "..", "frontend", "dist"),
      repoEnv: path.join(__dirname, "..", "backend", ".env"),
    };

const backend = new Backend();
let staticServer = null;
let mainWindow = null;
// set while quitting, so the teardown that runs on window close does not also
// run from the quit handler
let shuttingDown = false;
// The key prompt is a window, and closing it leaves the app with none for the
// moment before the real one opens. window-all-closed fires on that gap, so
// without this the app quit the instant someone finished typing their key.
let booting = true;

function missingBuild() {
  if (!fs.existsSync(RESOURCES.backendEntry)) return "backend/dist";
  if (!fs.existsSync(path.join(RESOURCES.frontendDir, "index.html"))) return "frontend/dist";
  return null;
}

/* -------------------------------------------------------------- api key */

// Shown once, on the first launch that finds no key anywhere. Skipping is
// allowed: the request builder, the proxy, variables, assertions and timings
// all work without a key, and only the scan and the agent need one.
function askForApiKey() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 320,
      resizable: false,
      title: "ReqFlow",
      backgroundColor: "#0a0a0a",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const finish = () => {
      ipcMain.removeHandler("api-key:save");
      ipcMain.removeAllListeners("api-key:done");
      if (!win.isDestroyed()) win.destroy();
      resolve();
    };

    ipcMain.handle("api-key:save", (_event, key) => {
      if (!looksLikeKey(key)) {
        return { ok: false, error: "paste the key on its own — no spaces, and not the whole KEY=value line" };
      }
      try {
        writeApiKey({ userDataDir: app.getPath("userData") }, key);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `could not save it: ${err.message}` };
      }
    });

    ipcMain.once("api-key:done", finish);
    // closing the window is the same as skipping
    win.on("closed", () => {
      ipcMain.removeHandler("api-key:save");
      ipcMain.removeAllListeners("api-key:done");
      resolve();
    });

    win.loadFile(path.join(__dirname, "key-prompt.html"));
  });
}

/* --------------------------------------------------------------- window */

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    // the app paints its own near black, and the default white flash before
    // the first frame is the most obvious tell that this is a wrapped page
    backgroundColor: "#0a0a0a",
    title: "ReqFlow",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // an external link opens in the browser rather than replacing the app with
  // a page it cannot navigate back from
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  mainWindow.loadURL(url);
  return mainWindow;
}

/* ------------------------------------------------------------- lifecycle */

async function boot() {
  const missing = missingBuild();
  if (missing) {
    dialog.showErrorBox(
      "ReqFlow is not built yet",
      `${missing} is missing.\n\nRun "npm run build" in the desktop folder first.`
    );
    app.quit();
    return;
  }

  const apiKey = readApiKey({
    userDataDir: app.getPath("userData"),
    repoEnvPath: RESOURCES.repoEnv,
  });

  // asked before the server starts, so the key is in place for the first
  // request rather than needing a restart to take effect
  if (!apiKey) await askForApiKey();

  try {
    const { adopted } = await backend.start({
      entry: RESOURCES.backendEntry,
      cwd: RESOURCES.backendCwd,
      apiKey: readApiKey({
        userDataDir: app.getPath("userData"),
        repoEnvPath: RESOURCES.repoEnv,
      }),
    });
    if (adopted) {
      console.log(`[desktop] reusing the backend already listening on ${PORT}`);
    }
  } catch (err) {
    dialog.showErrorBox(
      "ReqFlow's backend would not start",
      `${err.message}\n\nIf something else is using port ${PORT}, stop it and open ReqFlow again.`
    );
    app.quit();
    return;
  }

  staticServer = await startStaticServer(RESOURCES.frontendDir);
  console.log(`[desktop] serving the app from ${staticServer.url}`);
  createWindow(staticServer.url);
  booting = false;
}

// Closing the window must not leave the server running: it would hold port 4000
// and the next launch would find it, adopt it, and quietly talk to a copy of
// the app the user thought they had closed.
async function teardown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await backend.stop();
  if (staticServer) await staticServer.close();
}

app.whenReady()
  .then(boot)
  .catch((err) => {
    // booting stays true until the window opens, so a failure here would
    // otherwise leave an app that cannot be quit by closing anything
    booting = false;
    dialog.showErrorBox("ReqFlow could not start", String(err?.stack || err));
    app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && staticServer) createWindow(staticServer.url);
});

app.on("window-all-closed", () => {
  // during startup there is a moment with no windows: between the key prompt
  // closing and the main window opening. quitting there would end the app
  // immediately after a first launch, which is the one launch that has to work.
  if (booting) return;
  // on macOS an app normally stays in the dock with no windows. this one is a
  // window over a server, so with the window gone there is nothing left to be.
  app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  teardown().then(() => app.quit());
});

// a crash or a kill still gets the child stopped
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => teardown().then(() => process.exit(0)));
}

ipcMain.handle("open-external", (_event, url) => shell.openExternal(url));

// where the key lives, printed once so it can be edited or removed by hand
console.log(`[desktop] settings: ${userEnvPath(app.getPath("userData"))}`);
