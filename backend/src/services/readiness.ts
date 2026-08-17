import { forwardRequest } from "./proxy";

// After code lands in the project, the server that has to serve it is in one of
// three states, and they are not distinguishable from the outside at the moment
// of writing: restarting under a watcher, already back up, or never going to
// restart because nobody is watching. So this waits for something to answer and
// reports how long that took, and the caller decides what a 404 afterwards
// means. Guessing here would produce a number nobody measured.

// A watcher needs a moment to notice the write. Polling instantly would always
// find the outgoing process still listening and call it ready, which is the one
// answer that is never useful.
const SETTLE_MS = 500;
const POLL_INTERVAL_MS = 400;
export const READY_TIMEOUT_MS = 20_000;

export interface Readiness {
  up: boolean;
  // measured from the moment we started waiting, not estimated
  waitedMs: number;
  attempts: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForServer(
  origin: string,
  timeoutMs: number = READY_TIMEOUT_MS,
  // a wait is the longest thing here and the safest place to stop: nothing has
  // been written since, and a server that never became ready is stopped by
  // whoever started it
  signal?: AbortSignal
): Promise<Readiness> {
  const start = Date.now();
  let attempts = 0;

  await sleep(Math.min(SETTLE_MS, timeoutMs));

  for (;;) {
    if (signal?.aborted) return { up: false, waitedMs: Date.now() - start, attempts };
    attempts++;
    // status 0 is the proxy's word for "the connection itself failed". anything
    // above it means a process answered, even a 404, which is all readiness is.
    const res = await forwardRequest({ method: "GET", url: origin, headers: {} });

    if (res.blocked) {
      // not a server that is slow to come up, and waiting out the full timeout
      // to say so would look like a hang
      return { up: false, waitedMs: Date.now() - start, attempts };
    }
    if (res.status > 0) {
      return { up: true, waitedMs: Date.now() - start, attempts };
    }
    if (Date.now() - start >= timeoutMs) {
      return { up: false, waitedMs: Date.now() - start, attempts };
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
