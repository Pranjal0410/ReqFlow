const DEV_IP = "10.207.161.60"; // change only here when wifi changes

export const CONFIG = {
  // ReqFlow's own backend. only used to reach /analyze, /proxy and /ai-chat.
  API_BASE: `http://${DEV_IP}:4000/api`,

  // the server whose endpoints you are testing. this is a starting value that
  // you can edit in the sidebar, it is NOT ReqFlow's backend. pointing it at
  // port 4000 makes every scanned route 404, since that is ReqFlow itself.
  DEFAULT_TARGET: "http://localhost:3000",
};
