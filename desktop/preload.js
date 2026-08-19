const { contextBridge, ipcRenderer } = require("electron");

// Only the key prompt loads this. The app window itself is an ordinary web page
// talking to localhost over http, and gets the separate, deliberately tiny
// bridge in app-preload.js instead — one method, which opens a folder dialog and
// returns the path the user picked.
contextBridge.exposeInMainWorld("reqflow", {
  saveKey: (key) => ipcRenderer.invoke("api-key:save", key),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  done: () => ipcRenderer.send("api-key:done"),

  // the first-run engine choice. downloading gigabytes is the one thing this
  // app does that a user would be annoyed to discover afterwards, so it is
  // started from a button and reports what it is doing while it runs.
  models: () => ipcRenderer.invoke("model:catalogue"),
  download: (id) => ipcRenderer.invoke("model:download", id),
  cancelDownload: () => ipcRenderer.send("model:cancel"),
  chooseFile: () => ipcRenderer.invoke("model:choose-file"),
  chooseCloud: () => ipcRenderer.send("model:choose-cloud"),
  onProgress: (fn) => ipcRenderer.on("model:progress", (_event, data) => fn(data)),
});
