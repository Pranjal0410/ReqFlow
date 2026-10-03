import axios from "axios";
import {
  DetectedRoute,
  ApiResponse,
  GeneratedLayer,
  ApplyPlan,
  AppliedFile,
  VerifyPlan,
  VerifyResult,
  RunningProject,
} from "../types";
import { CONFIG } from "../config";

const BASE = CONFIG.API_BASE;

// No request may hang the interface forever. Nothing here had a timeout, so a
// backend that stopped answering left the panel saying "Waiting for the server"
// with no way out and no explanation — which is what a run that never settled
// looked like from the outside.
//
// The numbers are per operation rather than one global value, because they are
// different kinds of wait: reading a folder is quick, a model call is not, and
// verifying deliberately includes starting a server from cold.
const TIMEOUTS = {
  quick: 15_000,      // reading the project, listing what is running
  model: 120_000,     // a generation, which is a model round trip
  verify: 180_000,    // apply, reload the project, wait for it, call the endpoint
};

// An axios timeout arrives as "timeout of 15000ms exceeded", which tells the
// developer nothing they can act on. Every call that can time out says what it
// was waiting for instead.
function withTimeout<T>(work: Promise<T>, waitingFor: string): Promise<T> {
  return work.catch((err: any) => {
    if (err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message))) {
      throw new Error(`ReqFlow stopped waiting for ${waitingFor}. Its backend may have stopped — check the terminal running it.`);
    }
    throw err;
  });
}

export async function analyzeProject(projectPath: string): Promise<{
  routes: DetectedRoute[];
  filesScanned: number;
  // true when the backend still had this exact code from an earlier scan, so
  // the scan modal can say so instead of implying Gemini was asked again
  cached: boolean;
}> {
  const res = await withTimeout(axios.post(`${BASE}/analyze`, { projectPath }, { timeout: TIMEOUTS.model }), "the project scan")
  return res.data;
}

export interface DetectedPort {
  port: number;
  source: string;
}

// reads the folder without calling Gemini, so the scan modal can confirm the
// path is right and fill in the base url before anything is spent
export async function probeProject(projectPath: string): Promise<{
  filesScanned: number;
  filesFound: number;
  truncated: boolean;
  detectedPort: DetectedPort | null;
}> {
  const res = await withTimeout(axios.post(`${BASE}/analyze/files`, { projectPath }, { timeout: TIMEOUTS.quick }), "the project folder")
  return {
    filesScanned: res.data.filesScanned,
    filesFound: res.data.filesFound ?? res.data.filesScanned,
    truncated: !!res.data.truncated,
    detectedPort: res.data.detectedPort ?? null,
  };
}

// is the server we are about to call actually up? the proxy reports status 0
// when the connection itself fails, anything above that means something
// answered, even a 404 or a 500.
export async function checkTarget(origin: string): Promise<boolean> {
  const res = await withTimeout(
    axios.post(
      `${BASE}/proxy`,
      { method: "GET", url: origin, headers: {} },
      { timeout: TIMEOUTS.quick }
    ),
    "the server you are pointing at"
  );
  return typeof res.data?.status === "number" && res.data.status > 0;
}

export async function sendRequest(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: any
): Promise<ApiResponse> {
  // the backend's own proxy gives up at 30s, so this sits just outside it: a
  // slow target should be reported as slow by the trace, not as a client hang
  const res = await withTimeout(
    axios.post(`${BASE}/proxy`, { method, url, headers, body }, { timeout: 35_000 }),
    "your request"
  );
  return res.data;
}
// What applying the generated code would change, without changing any of it.
// The layers go back to the backend rather than a plan built here: the backend
// decides where the code lands, and a plan the client could author would make
// the apply endpoint a write-anything.
export async function planGenerated(
  projectPath: string,
  layers: GeneratedLayer[]
): Promise<ApplyPlan> {
  const res = await withTimeout(axios.post(`${BASE}/generate/plan`, { projectPath, layers }, { timeout: TIMEOUTS.quick }), "the diff")
  return res.data;
}

export async function applyGenerated(
  projectPath: string,
  layers: GeneratedLayer[]
): Promise<AppliedFile[]> {
  const res = await withTimeout(axios.post(`${BASE}/generate/apply`, { projectPath, layers }, { timeout: TIMEOUTS.quick }), "the files to be written")
  return res.data.applied;
}

// Runs the new endpoint and reads it back, once the server has answered. The
// headers and body handed over are already resolved: {{token}} stays in the tab
// the user keeps, the wire gets the value.
export async function verifyGenerated(input: {
  baseUrl: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  verify: VerifyPlan | null;
  serverWasUp: boolean;
  // so the wait can be stopped from the UI
  runId: string;
  // so ReqFlow can reload the project itself rather than hoping the developer
  // happens to be running a watcher
  projectPath: string | null;
  // The credential already in use in this workspace, offered only if the server
  // answers 401 while ReqFlow is looking for a record to act on. Not sent with
  // the endpoint call itself unless that is what got it in — a request the
  // developer wrote without auth is checked the way they wrote it.
  fallbackAuth: string | null;
}): Promise<VerifyResult> {
  const res = await withTimeout(axios.post(`${BASE}/generate/verify`, input, { timeout: TIMEOUTS.verify }), "your endpoint to be checked")
  return res.data;
}

// The code behind an endpoint the project already has.
//
// Generated endpoints carry their source; scanned ones do not, and "show me what
// serves this" is the same question for both.
export async function fetchRouteSource(
  projectPath: string,
  method: string,
  path: string
): Promise<{ found: boolean; file?: string; line?: number; code?: string; detail?: string }> {
  const res = await withTimeout(
    axios.post(`${BASE}/analyze/source`, { projectPath, method, path }, { timeout: TIMEOUTS.quick }),
    "the code behind this endpoint"
  );
  return res.data;
}

// What Settings can change about the model.
//
// The key is not in here, in either direction it is read. It goes out when the
// user types one and never comes back: the backend reports whether a key is set,
// never what it is, so nothing on this side can put a credential on screen.
export interface ModelSettings {
  provider: "gemini" | "local" | "embedded";
  keySet: boolean;
  localModelUrl: string;
  localModelPath: string;
  localModel: string;
  storedAt: string;
  writable: boolean;
}

export async function saveModelSettings(patch: {
  provider?: string;
  apiKey?: string;
  localModelUrl?: string;
  localModelPath?: string;
  localModel?: string;
}): Promise<{ saved: boolean; storedAt: string; detail?: string; settings: ModelSettings }> {
  const res = await withTimeout(
    axios.put(`${BASE}/model`, patch, { timeout: TIMEOUTS.quick }),
    "the setting to be saved"
  );
  return res.data;
}

// Which model is doing the work and whether it answers. A real call to the
// provider, so "configured" and "working" cannot be confused for each other.
export async function checkModel(): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  local: boolean;
  detail: string;
  settings?: ModelSettings;
}> {
  const res = await withTimeout(axios.get(`${BASE}/model`, { timeout: TIMEOUTS.quick }), "the model")
  return res.data;
}

// Stopping something already under way. Honoured where stopping leaves nothing
// half done: never in the middle of writing files, which takes milliseconds and
// where a cancel would produce the half-applied project this exists to prevent.
export async function cancelRun(kind: "generate" | "ai-chat", runId: string): Promise<boolean> {
  try {
    // the one call that must never itself hang: it is the way out of a hang
    const res = await axios.post(`${BASE}/${kind}/cancel/${runId}`, {}, { timeout: 5_000 });
    return !!res.data?.cancelled;
  } catch {
    // the run finishing first is the same outcome the developer wanted
    return false;
  }
}

// What ReqFlow is running on the developer's behalf, and how to stop it. Only
// ever a process it started itself: something else on that port is someone's own
// server and must be out of reach of this button.
export async function runningProjects(): Promise<RunningProject[]> {
  const res = await withTimeout(axios.get(`${BASE}/project`, { timeout: TIMEOUTS.quick }), "what is running")
  return res.data.running || [];
}

export async function stopProject(projectPath: string): Promise<RunningProject[]> {
  const res = await withTimeout(axios.post(`${BASE}/project/stop`, { projectPath }, { timeout: TIMEOUTS.quick }), "the server to stop")
  return res.data.running || [];
}

// built from the routes the client already holds, so this costs no model call
export async function exportOpenApi(
  routes: DetectedRoute[],
  title: string,
  baseUrl: string
): Promise<string> {
  const res = await withTimeout(axios.post(`${BASE}/analyze/openapi`, { routes, title, baseUrl }, { timeout: TIMEOUTS.quick }), "the OpenAPI document")
  return JSON.stringify(res.data, null, 2);
}

// The same collection, in Postman's format instead of ReqFlow's own — built
// from what the client already has, the same way the OpenAPI export is, so an
// existing ReqFlow user can keep working somewhere else without rebuilding it
// by hand.
export async function exportPostman(
  collection: any
): Promise<{ collection: any; environments: any[] }> {
  const res = await withTimeout(
    axios.post(`${BASE}/collection/postman`, { collection }, { timeout: TIMEOUTS.quick }),
    "the Postman export"
  );
  return res.data;
}

// A Postman collection, and optionally the environment(s) exported alongside
// it, read back into ReqFlow's own shape — the reverse of exportPostman, so a
// collection built there can be tried here without rebuilding it by hand.
export async function importPostman(
  collection: any,
  environments?: any[]
): Promise<{ collection: any }> {
  const res = await withTimeout(
    axios.post(
      `${BASE}/collection/postman/import`,
      { collection, environments },
      { timeout: TIMEOUTS.quick }
    ),
    "the Postman import"
  );
  return res.data;
}

export interface MockInfo {
  id: string;
  port: number;
}

// Stands up a fake server on the shapes of the requests already in the
// workspace, each answering with the sample given for it (a captured response,
// or nothing) — so a frontend can be built against them before the real
// backend exists, or without hitting it.
export async function startMockServer(
  requests: { method: string; url: string; sampleResponse?: any }[]
): Promise<MockInfo> {
  const res = await withTimeout(
    axios.post(`${BASE}/mock`, { requests }, { timeout: TIMEOUTS.quick }),
    "the mock server"
  );
  return res.data;
}

export async function stopMockServer(id: string): Promise<void> {
  await withTimeout(axios.delete(`${BASE}/mock/${id}`, { timeout: TIMEOUTS.quick }), "the mock server to stop");
}

// Every mock still up on the backend — which outlives a page reload, so this
// is how the sidebar finds one it started before and lost track of, rather
// than leaving it running forever with no way back to it but restarting the
// backend.
export async function listMockServers(): Promise<MockInfo[]> {
  const res = await withTimeout(axios.get(`${BASE}/mock`, { timeout: TIMEOUTS.quick }), "the running mocks");
  return res.data.running || [];
}

// The workspace as a file beside the code it tests. Written by the backend
// rather than downloaded, because a file in the project is what can be
// committed, reviewed, and run by `reqflow run` without the app.
export async function saveCollection(
  projectPath: string,
  collection: any
): Promise<{ written: boolean; path: string }> {
  const res = await withTimeout(
    axios.post(`${BASE}/collection`, { projectPath, collection }, { timeout: TIMEOUTS.quick }),
    "saving the collection"
  );
  return res.data;
}

export async function loadCollection(
  projectPath: string
): Promise<{ found: boolean; path: string; collection?: any }> {
  const res = await withTimeout(
    axios.get(`${BASE}/collection`, { params: { projectPath }, timeout: TIMEOUTS.quick }),
    "reading the collection"
  );
  return res.data;
}
