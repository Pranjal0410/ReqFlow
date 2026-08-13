import { Platform } from "react-native";

// Only the native app needs this. A phone cannot reach the dev machine by
// "localhost", so it has to be told an address, and that address changes with
// the wifi. Change it only here.
const DEV_IP = "10.207.161.60";

// On web the app is already being served by the dev machine, so whatever host
// loaded this page can serve the api too. Deriving it means a new wifi network
// cannot break the browser build, which is where a stale DEV_IP used to show up
// as every request timing out with nothing in the ui to explain it.
const API_HOST = Platform.OS === "web" ? window.location.hostname : DEV_IP;

export const CONFIG = {
  // ReqFlow's own backend. only used to reach /analyze, /proxy and /ai-chat.
  API_BASE: `http://${API_HOST}:4000/api`,

  // the server whose endpoints you are testing. this is a starting value that
  // you can edit in the sidebar, it is NOT ReqFlow's backend. pointing it at
  // port 4000 makes every scanned route 404, since that is ReqFlow itself.
  DEFAULT_TARGET: "http://localhost:3000",
};
