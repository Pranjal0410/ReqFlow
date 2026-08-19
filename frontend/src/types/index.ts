export interface DetectedRoute {
    method: string;
    path: string;
    description: string;
    params: string[];
    body: Record<string, any> | null;
  }
  
  // one metric out of the target server's Server-Timing header. duration is
  // null when the server named a span but sent no dur for it.
  export interface ServerTimingSpan {
    name: string;
    description: string | null;
    duration: number | null;
  }

  export interface ApiResponse {
    status: number;
    statusText: string;
    headers: Record<string, any>;
    data: any;
    timing: {
      total: number;
      // measured, not estimated. ttfb is the wait until the first byte of the
      // response, download is the time spent reading the body after that.
      ttfb: number;
      download: number;
    };
    // bytes. content-length when the server sent one, otherwise what we read
    size: number;
    sizeSource: "content-length" | "measured";
    // reported by the target server, not measured here. optional because a
    // workspace saved before this existed will not have it.
    serverTiming?: ServerTimingSpan[];
    blocked?: boolean;
  }

export interface TestCase {
  id: string;
  field: string;
  operator: string;
  value: string;
  passed: boolean | null;
}

// the rule lives with the code that runs it, the way Variable does; re-exported
// here so a component can take it from the one place it takes its other types
import type { Capture } from "../lib/capture";
export type { Capture };

export interface RequestTab {
  id: string;
  method: string;
  url: string;
  body: string;
  headers: { key: string; value: string; enabled: boolean }[];
  response: ApiResponse | null;
  loading: boolean;
  label: string;
  tests: TestCase[];
  // what this response gives to the ones after it: an id from a create, a token
  // from a login. Optional because a workspace saved before this existed has
  // none, and a tab with no rules is the normal case.
  captures?: Capture[];
  // values for the :name placeholders in url. kept apart from the url so the
  // placeholder survives being filled in and can be changed again.
  pathParams: Record<string, string>;
}

export type SubTab =
  | "params"
  | "headers"
  | "body"
  | "auth"
  | "tests"
  | "capture";

// Source for an endpoint the project does not have yet, written to match the
// files it does have. Putting code into someone's repository is a different
// decision from generating it, so it is shown first: the diff of every line it
// would change is read and approved before anything is written.
export interface GeneratedLayer {
  layer: string;
  // where the code belongs, relative to the project root
  path: string;
  code: string;
}

// An endpoint the agent drafted a request for that the scan has not found in
// the project. These are suggestions, and one sitting among the scanned routes
// with nothing to tell it apart would read as an endpoint that already exists —
// so the sidebar heads them "Generated" and says "not in the project yet". That
// label is what keeps them honest, and it keeps saying so after a restart, which
// is why they are now saved rather than forgotten.
export interface GeneratedRoute {
  method: string;
  // taken off the url, for reading and for comparing against the scan
  path: string;
  url: string;
  label: string;
  // the tab the agent already opened for it, so clicking the row goes back to
  // that request instead of stacking another copy of it
  tabId: string;
}

// how the endpoint gets proved once its code is in the project: run it, then
// read the result back. named by the model that wrote the routes rather than
// guessed off the path, because a wrong guess spends a real request on a 404.
export interface VerifyPlan {
  idFrom: string | null;
  get: { method: string; path: string } | null;
}

export interface GeneratedEndpoint {
  method: string;
  path: string;
  summary: string;
  layers: GeneratedLayer[];
  request: { headers: Record<string, string>; body: any | null };
  // anything the developer still has to do by hand, e.g. a schema change
  notes: string[];
  // the real files the style was read from, named so the claim is checkable
  references: { layer: string; path: string; reason: string }[];
  verify: VerifyPlan | null;
}

// what applying the code would do to each file, built by the same backend code
// that performs the write, so the diff cannot describe a different write
export interface FilePlan {
  layer: string;
  relPath: string;
  isNew: boolean;
  // 1-indexed line the block goes above. null means the end of the file.
  insertAbove: number | null;
  addedLines: number;
  // top-level declarations this write removes, when the same endpoint is being
  // applied a second time. named in the diff rather than removed quietly.
  replaced?: string[];
  code: string;
  // names this block calls into that nothing in the target file defines. an
  // early warning, not a refusal: running the endpoint is what settles it.
  undefinedNames: string[];
  // routes this block registers that a route already in the file matches first,
  // so they would be written and never reached
  shadowed?: { route: string; by: string; line: number }[];
}

export interface ApplyPlan {
  files: FilePlan[];
  // git is the undo when there is one. when there is not, backups are.
  git: { repo: boolean; dirty: string[] };
  backups: boolean;
}

export interface AppliedFile {
  relPath: string;
  isNew: boolean;
  addedLines: number;
  backup: string | null;
}

// one half of the automated run: the request that was sent and what came back
export interface VerifyExchange {
  method: string;
  url: string;
  response: ApiResponse;
}

// What happened to a change, as one answer rather than two. "Applied" beside a
// separate "POST failed" leaves the developer to work out which of the two is
// the real state of their project — and the natural reading of a green
// "applied" is that it worked, which is exactly what has not been established.
export type ApplyVerdict =
  // ran and answered as it should
  | "verified"
  // written, ran, and did not work
  | "failed"
  // written, but there was no way to find out: nothing was listening
  | "unverified";

export interface ApplyOutcome {
  verdict: ApplyVerdict;
  text: string;
}

// Which of the three things happened to the server, so the app can say it
// rather than imply it. Claiming to run a server the developer started
// themselves — and offering to stop it — would be a claim on something of theirs.
export type Ownership = "started" | "restarted" | "existing" | "none";

// A project ReqFlow itself spawned. Named and stoppable, because a process the
// app started that the developer can neither see nor stop is their machine
// running something they never chose and cannot find.
export interface RunningProject {
  projectPath: string;
  command: string;
  pid: number | null;
  since: number;
}

// Where the time went, measured by the backend. Pressing Apply took most of a
// minute once and nobody could say which part was slow.
export interface PhaseTiming {
  phase: string;
  ms: number;
}

// One finished apply-and-verify, kept so the last few can be looked at again
// without running anything a second time.
export interface RunRecord {
  id: string;
  at: number;
  method: string;
  path: string;
  verdict: ApplyVerdict;
  text: string;
  phases: PhaseTiming[];
}

export interface VerifyResult {
  ready: boolean;
  // measured wait for the server to answer, never estimated
  waitedMs: number;
  // false when the server answered but 404s the new route, i.e. it is running
  // code from before the write
  pickedUp?: boolean;
  // the server was answering before the write and is not now, so what was just
  // applied is the likely cause rather than a server that happened to be down
  brokeServer?: boolean;
  // the developer stopped the check. the files stay written, which the message
  // says plainly — reporting it as a failure would be wrong twice over.
  cancelled?: boolean;
  // measured per phase, so "it was slow" can be answered with where
  phases?: PhaseTiming[];
  ownership?: Ownership;
  // the record ReqFlow found to act on, named so "it worked" is checkable
  usedRecordId?: string | null;
  // what to do about this particular status. null when the outcome needs no
  // direction beyond what the lines already say.
  nextStep?: string | null;
  create?: VerifyExchange;
  read?: VerifyExchange;
  message?: string;
}

// A rule the user stated once and should not have to state again: naming,
// validation library, error shape. Saved with the workspace rather than held in
// the conversation, because the point is that it outlives the conversation.
export interface Instruction {
  id: string;
  text: string;
  // switched off rather than deleted is a real state: a rule you want back next
  // week should not have to be retyped, and one that is off must not be sent
  enabled: boolean;
  at: number;
  // whether the agent picked it up from something the user said, or the user
  // typed it in the panel. shown, because "the app decided this about me" and
  // "I wrote this" are different things to be looking at.
  source: "agent" | "manual";
}

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  timing: number;
  at: number;
}