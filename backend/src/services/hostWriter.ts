// Writing through the process that is allowed to.
//
// On macOS the folder dialog grants access to the process that presented it —
// the desktop app itself. The backend is a child of that app, and for a signed
// app it would inherit the grant. This one is ad-hoc signed, which gives it no
// stable identity, so the child is judged on its own and has none: it can read
// the project and cannot write to it.
//
// So when a write is refused, it is handed to the parent, which can. Nothing
// changes when there is no parent — running the backend on its own, the write
// happens here as it always did, and this file does nothing.

export interface HostWrite {
  path: string;
  content: string;
}

// how long to wait for the parent before giving up on it. Short: it is a local
// process writing local files, and a developer staring at a spinner learns less
// than one reading the original refusal.
const REPLY_TIMEOUT_MS = 5000;

export function hasHost(): boolean {
  return typeof process.send === "function";
}

let nextId = 1;

export function writeThroughHost(files: HostWrite[]): Promise<void> {
  if (!hasHost()) return Promise.reject(new Error("no host process to write through"));

  const id = nextId++;

  return new Promise<void>((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      process.off("message", onMessage);
      err ? reject(err) : resolve();
    };

    const onMessage = (message: any) => {
      if (!message || message.type !== "reqflow:write-result" || message.id !== id) return;
      done(message.ok ? undefined : new Error(message.error || "the app could not write it either"));
    };

    const timer = setTimeout(
      () => done(new Error("the app did not answer the request to write these files")),
      REPLY_TIMEOUT_MS
    );

    process.on("message", onMessage);
    process.send!({ type: "reqflow:write", id, files });
  });
}
