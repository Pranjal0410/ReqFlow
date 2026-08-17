// Stopping something that is already under way, without leaving it half done.
//
// A generation can take half a minute against a hosted model and minutes against
// a local one, and until this there was no way out of it but to wait. The
// difficulty is not offering the button; it is choosing where it may be honoured.
//
// Cancellation is checked at points where stopping leaves nothing half finished:
//
//   between tool rounds       nothing has been written; the run simply ends
//   before a set of writes    the files are untouched
//   while waiting for a server  the wait ends, and a server that never became
//                               ready is stopped by whoever started it
//
// It is deliberately *not* honoured in the middle of writing files. Applying a
// change touches two or three files and takes milliseconds; a cancel landing
// between them would produce exactly the half-applied project this feature is
// supposed to prevent. Waiting those milliseconds out is the safe answer.

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

interface Entry {
  controller: AbortController;
  at: number;
}

const runs = new Map<string, Entry>();

// A run that is never cancelled still has to stop being remembered, or a long
// session accumulates a controller per request forever.
const TTL_MS = 10 * 60 * 1000;

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of runs) {
    if (now - entry.at > TTL_MS) runs.delete(id);
  }
}

export function beginRun(runId?: string): AbortSignal | undefined {
  if (!runId) return undefined;
  sweep();

  // a repeated id replaces the old controller: whatever it belonged to is over,
  // and keeping it would let an old cancel land on a new run
  runs.set(runId, { controller: new AbortController(), at: Date.now() });
  return runs.get(runId)!.controller.signal;
}

export function cancelRun(runId: string): boolean {
  const entry = runs.get(runId);
  if (!entry || entry.controller.signal.aborted) return false;
  entry.controller.abort();
  return true;
}

export function endRun(runId?: string): void {
  if (runId) runs.delete(runId);
}

export function isCancelled(signal?: AbortSignal): boolean {
  return !!signal?.aborted;
}

// Called at the safe points. Throwing rather than returning a flag means a
// caller cannot forget to check the return value and carry on regardless.
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Cancelled();
}

export function isCancellation(err: unknown): boolean {
  return err instanceof Cancelled || (err as any)?.name === "Cancelled";
}
