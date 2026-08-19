const { contextBridge, ipcRenderer } = require("electron");

// The app window's bridge, and all of it.
//
// This window is an ordinary web page talking to localhost, and it was given no
// bridge at all on purpose: nothing it renders should be able to reach the
// filesystem or the shell. That held until the one thing a desktop app is
// expected to do — let you pick a folder — turned out to need it. Typing a path
// by hand is not what anyone expects from a Mac app, and on macOS it is also
// what makes writing fail: choosing a folder in a real dialog is the act that
// grants the app access to it.
//
// So: one method. It opens a dialog, waits for a person, and returns a string.
// It cannot read a file, write one, or run anything. Anything else this window
// needs still goes over http to the backend, where it can be seen.
contextBridge.exposeInMainWorld("reqflowDesktop", {
  chooseProjectFolder: () => ipcRenderer.invoke("project:choose-folder"),
});
