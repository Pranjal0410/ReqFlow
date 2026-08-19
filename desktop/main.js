const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");

const { startStaticServer } = require("./lib/staticServer");
const { Backend, PORT } = require("./lib/backend");
const {
  readApiKey,
  writeApiKey,
  sealExistingKey,
  looksLikeKey,
  userEnvPath,
} = require("./lib/apiKey");
const {
  catalogue,
  findModel,
  modelFile,
  partFile,
  readChoice,
  writeChoice,
  modelState,
  download,
  looksLikeGguf,
} = require("./lib/model");

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

// Two copies of ReqFlow cannot both have port 4000. The second one used to
// find the first one's server, adopt it, and open a window onto it — two
// windows over one backend, and quitting either took the server with it. So
// only one instance runs, and opening the app again raises the window that is
// already there.
const gotTheLock = app.requestSingleInstanceLock();

const backend = new Backend();
let staticServer = null;
let mainWindow = null;
// where the backend's output is being kept, so a message about it can say
let logFile = null;
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
        writeApiKey({ userDataDir: app.getPath("userData"), safeStorage }, key);
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

/* ---------------------------------------------------------------- model */

// Where the model runs is asked once, on the first launch, and never again
// unless the answer stops working. Running it here is the reason this is a
// desktop app rather than a web page: the weights can sit next to the code they
// are reading, and no interaction has to cross a network.
//
// Nothing downloads on its own. Several gigabytes arriving unannounced is the
// kind of thing that makes people distrust an app, so the window asks first and
// shows what it is fetching while it fetches it.
function askAboutModel() {
  return new Promise((resolve) => {
    const userDataDir = app.getPath("userData");
    const win = new BrowserWindow({
      width: 560,
      height: 520,
      resizable: false,
      title: "ReqFlow",
      backgroundColor: "#0a0a0a",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let aborter = null;

    const cleanup = () => {
      for (const channel of ["model:catalogue", "model:download", "model:choose-file"]) {
        ipcMain.removeHandler(channel);
      }
      ipcMain.removeAllListeners("model:cancel");
      ipcMain.removeAllListeners("model:choose-cloud");
    };

    const finish = (choice) => {
      cleanup();
      if (!win.isDestroyed()) win.destroy();
      resolve(choice);
    };

    ipcMain.handle("model:catalogue", () => ({
      catalogue: catalogue(),
      // a download that was interrupted last time is offered as a resume, so
      // nobody is told to fetch four gigabytes they already have
      partial: Object.fromEntries(
        catalogue().map((m) => {
          const file = modelFile(userDataDir, m.id);
          let bytes = 0;
          try {
            bytes = fs.statSync(partFile(file)).size;
          } catch {
            bytes = 0;
          }
          return [m.id, bytes];
        })
      ),
    }));

    ipcMain.handle("model:download", async (_event, id) => {
      const model = findModel(id);
      if (!model) return { ok: false, error: "no such model" };

      aborter = new AbortController();
      const target = modelFile(userDataDir, id);

      try {
        await download(model.url, target, {
          signal: aborter.signal,
          onProgress: (p) => {
            if (!win.isDestroyed()) win.webContents.send("model:progress", p);
          },
        });
      } catch (err) {
        return { ok: false, error: err.message };
      }

      // an HTML error page saved under the right name is the likeliest wrong
      // file, and it would fail at the first scan instead of here
      if (!looksLikeGguf(target)) {
        fs.rmSync(target, { force: true });
        return { ok: false, error: "what arrived is not a model file. Try again." };
      }

      writeChoice(userDataDir, { kind: "catalogue", id });
      finish({ kind: "catalogue", id });
      return { ok: true };
    });

    ipcMain.handle("model:choose-file", async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Choose a .gguf model",
        properties: ["openFile"],
        filters: [{ name: "GGUF model", extensions: ["gguf"] }],
      });
      if (canceled || !filePaths[0]) return { ok: false };

      if (!looksLikeGguf(filePaths[0])) {
        return { ok: false, error: "that file is not a GGUF model" };
      }

      writeChoice(userDataDir, { kind: "custom", path: filePaths[0] });
      finish({ kind: "custom", path: filePaths[0] });
      return { ok: true };
    });

    ipcMain.once("model:choose-cloud", () => {
      writeChoice(userDataDir, { kind: "cloud" });
      finish({ kind: "cloud" });
    });

    ipcMain.on("model:cancel", () => {
      aborter?.abort();
      // closing on cancel rather than returning to the list: the part file is
      // kept, so opening ReqFlow again offers to carry on from where it stopped
      finish(null);
    });

    // closing the window without answering is not a choice, and is not recorded
    // as one. the next launch asks again.
    win.on("closed", () => {
      cleanup();
      resolve(null);
    });

    win.loadFile(path.join(__dirname, "model-prompt.html"));
  });
}

/* --------------------------------------------------------------- window */


// Startup blocks on the keychain, and the keychain blocks the main thread.
//
// Reading the sealed key ends up in SecKeychainFindGenericPassword, which is
// synchronous: it sends a mach message to the security server and does not
// return until the user has answered the system's authorization prompt. A
// sample of the main thread during a first launch is a single stack, 1499 of
// 1499 samples deep in mach_msg2_trap under CSSM_DecryptDataFinal.
//
// Nothing else runs while that is happening — including the local server this
// window loads its own content from. So the window is created, asks for its
// page, and the answer never comes: ready-to-show never fires, and the app
// shows nothing at all. Quitting and relaunching works because by then the
// authorization has been given and the read returns at once. Two people
// reported exactly that.
//
// Creating the window first was not enough. It has to have painted. Awaiting
// this yields to the event loop, which is what lets the server answer, the
// page load and the window appear — so when the keychain does block, there is
// an app on screen behind the prompt rather than nothing.
function windowOnScreen(win, ms = 15000) {
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  if (win.isVisible()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const done = (shown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(shown);
    };

    // A window that fails to load must not hold the launch forever; the rest
    // of startup is still worth running, and the failure shows in the window.
    const timer = setTimeout(() => done(false), ms);

    win.once("ready-to-show", () => done(true));
    win.webContents.once("did-finish-load", () => done(true));
    win.once("closed", () => done(false));
  });
}

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
      // one method, defined in app-preload.js: open a folder dialog and return
      // the path. Typing a path by hand is not what a desktop app should ask
      // for, and on macOS choosing a folder in a real dialog is also what
      // grants the app permission to write into it.
      preload: path.join(__dirname, "app-preload.js"),
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

// The folder the developer wants to work on, chosen the way a desktop app
// chooses one. Registered once, and it does nothing but ask and answer.
ipcMain.handle("project:choose-folder", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose a project folder",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Scan this folder",
  });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});

/* ------------------------------------------------------------- lifecycle */

// Asked only when port 4000 answers as something other than ReqFlow. Carrying
// on is offered because the guess can be wrong — an older ReqFlow build whose
// health endpoint does not name itself answers the same way as a stranger —
// but quitting is the default, since the alternative is a backend that cannot
// listen.
async function askAboutPortConflict() {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "ReqFlow",
    message: `Port ${PORT} is already in use.`,
    detail:
      `Something that is not ReqFlow's backend is listening on port ${PORT}. ` +
      `ReqFlow cannot start its own server while it is there.\n\n` +
      `Stop that program and open ReqFlow again, or start anyway to see what the backend reports.`,
    buttons: ["Quit", "Start Anyway"],
    defaultId: 0,
    cancelId: 0,
  });
  return response === 1;
}

// The backend is restarted quietly when it dies, because a server that comes
// back within a second is not something the user needs to be told about. This
// is for when it will not stay up: at that point the window is a page whose
// every request fails, and saying nothing would leave them to work that out.
function reportBackendGaveUp(message) {
  console.error(`[desktop] ${message}`);
  dialog.showMessageBox({
    type: "error",
    title: "ReqFlow",
    message: "ReqFlow's backend keeps stopping.",
    detail: `${message}\n\nQuit and open ReqFlow again. The full log is at:\n${logFile || "(no log file)"}`,
    buttons: ["OK"],
  });
}

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

  // The window comes first. Before the backend, and before anything that
  // touches the keychain.
  //
  // It used to be last: the key was read, the backend was started, up to twenty
  // seconds were spent waiting for it to answer, and only then did anything
  // appear. Two people reported the app simply not opening and relaunched it.
  //
  // The waiting was only half of it. Reading the sealed key asks macOS for
  // keychain access, and an ad-hoc signed app has no stable identity — so the
  // system puts up its own authorization prompt, every new build, before this
  // app has drawn a single pixel. A dialog with nothing behind it is
  // indistinguishable from an app that has hung.
  //
  // The window is the app. Everything else is something it does once it exists.
  staticServer = await startStaticServer(RESOURCES.frontendDir);
  console.log(`[desktop] serving the app from ${staticServer.url}`);
  createWindow(staticServer.url);

  // and it is on screen before anything asks the keychain a question
  const painted = await windowOnScreen(mainWindow);
  if (!painted) console.log("[desktop] the window did not report itself ready; continuing");

  // an install from before the key was encrypted still has it in plain text,
  // and this is the launch that moves it
  const moved = sealExistingKey({ userDataDir: app.getPath("userData"), safeStorage });
  if (moved?.moved) {
    console.log(
      moved.removed
        ? "[desktop] moved the stored key into the system keychain"
        : `[desktop] stored the key in the system keychain, but could not remove the plain copy: ${moved.error}`
    );
  }

  const userDataDir = app.getPath("userData");

  // Asked before the key is, because the answer decides whether a key is
  // needed at all. Someone who runs the model here should not be asked for a
  // credential they will never use.
  if (!readChoice(userDataDir)) await askAboutModel();

  let model = modelState(userDataDir);
  const choice = readChoice(userDataDir);

  // A model that was chosen and then went missing — deleted, or an external
  // disk that is not plugged in — is offered again rather than failing at the
  // first scan with a path nobody remembers choosing.
  if (choice && choice.kind !== "cloud" && !model.ready) {
    console.log("[desktop] the chosen model file is not there, asking again");
    await askAboutModel();
    model = modelState(userDataDir);
  }

  const usingLocalModel = model.ready;

  const apiKey = readApiKey({
    userDataDir,
    repoEnvPath: RESOURCES.repoEnv,
    safeStorage,
  });

  // asked before the server starts, so the key is in place for the first
  // request rather than needing a restart to take effect. skipped entirely
  // when the model runs here: there is nothing for a key to authorise.
  if (!apiKey && !usingLocalModel) await askForApiKey();

  try {
    // "logs" is a real place on all three platforms, but asking for a path
    // Electron does not have on this one throws, and a launch is not worth
    // losing over where the log goes
    logFile = backend.openLog(app.getPath("logs"));
    if (logFile) console.log(`[desktop] backend log: ${logFile}`);
  } catch (err) {
    console.error(`[desktop] no backend log this run: ${err.message}`);
  }

  try {
    const { adopted } = await backend.start({
      entry: RESOURCES.backendEntry,
      cwd: RESOURCES.backendCwd,
      apiKey: readApiKey({
        userDataDir,
        repoEnvPath: RESOURCES.repoEnv,
        safeStorage,
      }),
      // The backend loads the weights itself, in its own process. Nothing is
      // proxied and no second process is started: the model ends up in the same
      // place the request handling is, which is what makes it fast.
      modelPath: usingLocalModel ? model.path : null,
      // Settings writes here. It is the same file readApiKey() already looks in,
      // so a key saved from inside the app is picked up next launch — and
      // sealExistingKey() moves it into the keychain then, leaving no plain copy.
      settingsFile: path.join(userDataDir, ".env"),
      onConflict: askAboutPortConflict,
      onGiveUp: reportBackendGaveUp,
    });
    if (adopted) {
      console.log(`[desktop] reusing the backend already listening on ${PORT}`);
    }
    console.log(
      usingLocalModel
        ? `[desktop] the model runs here: ${model.path}`
        : "[desktop] using the hosted model"
    );
  } catch (err) {
    // the conflict was already explained in its own dialog, and the user chose
    // to quit rather than press on
    if (err.code !== "PORT_CONFLICT") {
      dialog.showErrorBox(
        "ReqFlow's backend would not start",
        `${err.message}\n\nIf something else is using port ${PORT}, stop it and open ReqFlow again.`
      );
    }
    app.quit();
    return;
  }

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

if (!gotTheLock) {
  // exit rather than quit: quit runs the teardown, and this instance owns
  // nothing to tear down. The one already running does.
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(boot)
    .catch((err) => {
      // booting stays true until the window opens, so a failure here would
      // otherwise leave an app that cannot be quit by closing anything
      booting = false;
      dialog.showErrorBox("ReqFlow could not start", String(err?.stack || err));
      app.quit();
    });
}

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

// where the key lives, printed once so it can be replaced or removed by hand.
// Encrypted, it is no longer a file to edit — deleting it is how you start over,
// and the first launch after that asks for a key again.
console.log(`[desktop] settings: ${path.dirname(userEnvPath(app.getPath("userData")))}`);
