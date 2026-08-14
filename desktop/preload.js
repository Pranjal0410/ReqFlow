const { contextBridge, ipcRenderer } = require("electron");

// Only the key prompt loads this. The app window itself is an ordinary web page
// talking to localhost over http and is given no bridge at all, so nothing it
// renders can reach the filesystem or the shell.
contextBridge.exposeInMainWorld("reqflow", {
  saveKey: (key) => ipcRenderer.invoke("api-key:save", key),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  done: () => ipcRenderer.send("api-key:done"),
});
