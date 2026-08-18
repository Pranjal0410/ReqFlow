import { Router, Request, Response } from "express";
import {
  getProvider,
  ToolDeclaration,
  ToolCall,
  ToolResult,
  providerName,
} from "../services/llm";
import { forwardRequest } from "../services/proxy";
import { beginRun, endRun, cancelRun } from "../services/cancellation";
import { generateEndpoint, GeneratedEndpoint } from "../services/codegen";
import {
  Instruction,
  coerceInstructions,
  formatInstructions,
  MAX_INSTRUCTIONS,
  MAX_INSTRUCTION_CHARS,
} from "../services/instructions";

const router = Router();

// how many tool round trips before we stop. keeps a confused model from
// hammering an endpoint forever.
const MAX_TOOL_ROUNDS = 25;

// the agent acts without asking, so the runaway case needs a ceiling rather
// than a confirmation step. counted across the whole conversation, not per
// turn. 15 was too tight for the thing this is actually for: a 14 route
// project needs a login plus one call each, which left nothing for the retries
// a real run always has.
export const MAX_ACTIONS_PER_CHAT = 30;

const sendRequestTool: ToolDeclaration = {
  name: "send_request",
  description:
    "Send a real HTTP request and get the actual response back. Use this to test endpoints instead of describing what the user should do. Returns status, headers, body and timing.",
  parameters: {
    properties: {
      method: {
        type: "string",
        description: "HTTP method, e.g. GET, POST, PUT, PATCH, DELETE",
      },
      url: {
        type: "string",
        description: "Full URL including protocol and port, e.g. http://localhost:3001/api/users",
      },
      headers: {
        type: "string",
        description:
          "Optional request headers as a JSON object string, e.g. {\"Authorization\":\"Bearer abc\"}",
      },
      body: {
        type: "string",
        description: "Optional request body as a JSON string. Omit for GET.",
      },
    },
    required: ["method", "url"],
  },
};

// the two tools below never touch the network. they hand a filled in request or
// a set of checks back to the ui for the developer to look over and run, which
// is why they stay available even when read-only mode blocks send_request.
const createRequestTool: ToolDeclaration = {
  name: "create_request",
  description:
    "Open a new request tab in the user's UI, pre-filled with a method, url, headers and body. Nothing is sent: the user reviews it and presses Send themselves. Use this when the user asks you to set up, prepare or draft a request rather than run it. Works in read-only mode.",
  parameters: {
    properties: {
      method: {
        type: "string",
        description: "HTTP method, e.g. GET, POST, PUT, PATCH, DELETE",
      },
      url: {
        type: "string",
        description: "Full URL including protocol and port",
      },
      headers: {
        type: "string",
        description: "Optional headers as a JSON object string",
      },
      body: {
        type: "string",
        description: "Optional request body as a JSON string. Omit for GET.",
      },
      label: {
        type: "string",
        description: "Short label for the tab, e.g. 'Create incident'",
      },
    },
    required: ["method", "url"],
  },
};

const createAssertionsTool: ToolDeclaration = {
  name: "create_assertions",
  description:
    "Add assertions to the Tests panel of the user's active tab. They run automatically the next time that request is sent. Use this when the user asks for checks or tests on a response. Works in read-only mode.",
  parameters: {
    properties: {
      assertions: {
        type: "string",
        description:
          'JSON array string. Each item is {"field","operator","value"}. field must start with one of: status, statusText, timing (ms), ttfb (ms), size (bytes), or data. The response payload lives under data, so check the body with data.id or data.user.email, never body.id. operator is one of: equals, not equals, contains, exists, greater than, less than. value is compared as a string and is ignored by exists.',
      },
    },
    required: ["assertions"],
  },
};

const setVariableTool: ToolDeclaration = {
  name: "set_variable",
  description:
    "Store a value as a workspace variable the user can reuse as {{name}} in any tab's url, headers or body. Use this right after a login so the token stops being tied to one tab. Setting an existing name replaces it. Works in read-only mode.",
  parameters: {
    properties: {
      name: {
        type: "string",
        description: "Variable name, letters, digits, underscore, dot or dash. e.g. token",
      },
      value: { type: "string" as const, description: "The value to store" },
    },
    required: ["name", "value"],
  },
};

const generateCodeTool: ToolDeclaration = {
  name: "generate_code",
  description:
    "Write the code for an endpoint that does not exist yet, in the style of the project's own router, controller and service files. The code is shown to the user to read and copy; it is NOT written to their files. A ready-to-test request tab opens alongside it. Use this when the user asks you to implement, add, build, write or create an endpoint, rather than to test one. Works in read-only mode.",
  parameters: {
    properties: {
      description: {
        type: "string",
        description:
          "What the endpoint should do, in full. Include the method and path if the user gave them, what it accepts, what it returns, and any auth or validation they mentioned. Everything the code generator knows comes from this string, so do not abbreviate it.",
      },
    },
    required: ["description"],
  },
};

// The point of this one is that the user stops repeating themselves. It is not
// a memory of the conversation — the history already carries that — it is for
// the standing rules that outlive it: naming, validation, error shape. They go
// into the workspace, where the user can read and switch off every one of them,
// because a rule the app follows and the user cannot find is worse than a rule
// they have to say twice.
const rememberInstructionTool: ToolDeclaration = {
  name: "remember_instruction",
  description:
    "Save a standing instruction about how the user wants code written or requests built, so they never have to repeat it. Call this when they state a durable preference — naming conventions, validation library, error response shape, auth style — not for one-off facts about this task, and not for anything specific to a single endpoint. Write it as a short imperative sentence in the user's own terms. Works in read-only mode.",
  parameters: {
    properties: {
      text: {
        type: "string",
        description:
          'The rule, as one short imperative sentence, e.g. "Use camelCase for JSON field names" or "Validate request bodies with zod".',
      },
    },
    required: ["text"],
  },
};

// matches the {{name}} pattern the frontend resolves
const VARIABLE_NAME = /^[A-Za-z0-9_.-]+$/;
const VARIABLE_TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

// the agent is told to write {{token}} rather than the raw value, so its own
// requests have to resolve the same placeholders the frontend does. an unknown
// name is left alone so a typo is visible instead of silently blank.
function resolveVars(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  return text.replace(VARIABLE_TOKEN, (whole, name) => (name in vars ? vars[name] : whole));
}

// same set the frontend's runAssertions() understands. anything else would be
// stored as a test that can never pass.
const ASSERTION_OPERATORS = [
  "equals",
  "not equals",
  "contains",
  "exists",
  "greater than",
  "less than",
];

// the roots runAssertions() resolves against. a field under any other root
// reads as undefined forever, so it is a broken test, not a failing one.
const ASSERTION_ROOTS = ["status", "statusText", "timing", "ttfb", "size", "data"];

function normaliseField(field: string): { field: string; note?: string } | null {
  // "body.id" is the obvious slip: the response payload is called data here
  const fixed = field.replace(/^body(\.|$)/, "data$1");
  const root = fixed.split(".")[0];

  if (!ASSERTION_ROOTS.includes(root)) return null;
  return fixed === field ? { field: fixed } : { field: fixed, note: `${field} -> ${fixed}` };
}

// the request the user has open, rendered for the prompt. an empty tab is
// described as empty rather than omitted, so the agent does not assume the
// user is pointing at something they are not.
function describeActiveTab(tab: any): string {
  if (!tab || typeof tab !== "object" || !tab.url) {
    return "The user's open tab is empty, so there is nothing on screen to reason about. If they say \"this\" or \"it\", ask what they mean.";
  }

  const lines = [`${String(tab.method || "GET")} ${tab.url}`];

  const headers = tab.headers && typeof tab.headers === "object" ? tab.headers : {};
  const headerNames = Object.keys(headers);
  if (headerNames.length) {
    lines.push(`headers: ${headerNames.map((k) => `${k}: ${headers[k]}`).join(", ")}`);
  }
  if (tab.body) lines.push(`request body:\n${tab.body}`);

  if (tab.response) {
    lines.push(
      `response: ${tab.response.status} ${tab.response.statusText} in ${tab.response.timing}ms`,
      `response body:\n${tab.response.data}`
    );
  } else {
    lines.push("this request has not been sent yet, so there is no response");
  }

  if (Array.isArray(tab.tests) && tab.tests.length) {
    lines.push(
      `assertions: ${tab.tests
        .map(
          (t: any) =>
            `${t.field} ${t.operator} ${t.value}${
              t.passed === null ? " (not run)" : t.passed ? " (passed)" : " (FAILED)"
            }`
        )
        .join("; ")}`
    );
  }

  const alreadyRan = tab.response
    ? `\n\nThis request has already run and its result is above, so do not send it again to "check". You would spend an action to learn what you have just been told, and for a POST, PUT, PATCH or DELETE you would repeat the write. Send it again only if the user explicitly asks you to retry, or if you are changing something about it first.`
    : "";

  return `This is the tab the user is looking at right now. When they say "this", "it" or "the request", they mean this one.
${lines.join("\n")}${alreadyRan}`;
}

// what goes into a tab's body editor: pretty printed when it is json, left
// exactly as sent when it is not
function formatBody(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw === "object") return JSON.stringify(raw, null, 2);

  const text = String(raw);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function parseJsonArg(raw: unknown): any {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return undefined;
  }
}

// the agent works on its own by default, so writes are on unless the user has
// turned the read-only toggle on. login stays allowed even then, without it
// nothing behind auth is testable.
function isAllowed(method: string, url: string, allowWrites: boolean) {
  const m = method.toUpperCase();
  if (allowWrites || m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  if (m === "POST" && /\/(login|signin|token)\b/i.test(url)) return true;
  return false;
}

import { readableModelError, RETRYABLE, QUOTA_SPENT } from "../services/modelErrors";

// Five attempts over half a minute, not three over eleven seconds. The free
// tier answers 503 "high demand" in bursts that last longer than eleven
// seconds, and a request that takes twenty seconds and succeeds is worth far
// more than one that gives up quickly — this is the only model in the family
// that accepts the function role our tool calls need, so there is nowhere else
// to fall back to. Quota failures are excluded from this and fail immediately.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

// A run can take a minute across a dozen endpoints, and until it returned the
// panel showed a spinner and nothing else. The log is built up as the run goes,
// so it is published here for the frontend to poll rather than being held back
// until the whole thing finishes.
// A tool that takes twenty seconds and only logs when it finishes leaves the
// panel saying "thinking" for the whole of it. The note is a place for a tool
// to say what it is doing while it is still doing it, and the object is shared
// by reference so setting it mid-call is visible to the next poll.
export interface RunNote {
  text: string | null;
}

const runs = new Map<string, { log: ActionLogEntry[]; note: RunNote; at: number }>();
const RUN_TTL_MS = 5 * 60 * 1000;

function publishRun(runId: string | undefined, log: ActionLogEntry[], note: RunNote) {
  if (!runId) return;
  runs.set(runId, { log, note, at: Date.now() });
  // a client that goes away mid-run would otherwise leave its log behind
  for (const [id, entry] of runs) {
    if (Date.now() - entry.at > RUN_TTL_MS) runs.delete(id);
  }
}

// Stopping a run that is under way. Honoured between tool rounds, where nothing
// is half done: the tools that write have already finished or have not started.
router.post("/cancel/:runId", (req: Request, res: Response) => {
  const cancelled = cancelRun(String(req.params.runId));
  res.json({
    cancelled,
    // false is not a failure: the run had already finished, which is the same
    // outcome the developer wanted
    detail: cancelled ? "cancelling" : "that run had already finished",
  });
});

router.get("/progress/:runId", (req: Request, res: Response) => {
  const entry = runs.get(String(req.params.runId));
  res.json({ actions: entry ? entry.log : [], note: entry ? entry.note.text : null });
});

// A used-up daily quota is a 429 like any other, so this used to retry it three
// times over eleven seconds — three more requests against a quota that had
// nothing left to give, and eleven seconds before the developer was told
// anything. Waiting only helps for the transient kind.
async function sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err: any) {
      const raw = String(err?.message || err);
      const worthWaitingFor = RETRYABLE.test(raw) && !QUOTA_SPENT.test(raw);
      if (!worthWaitingFor || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

// one line per thing the agent did, sent or written. this is what the user sees
// under the reply, and it is the whole accountability story now that nothing is
// gated behind a confirmation.
// the whole exchange rides along, request and response both. without it the
// agent is the only one who ever sees what it was asked to fetch, and the user
// cannot open it in a tab without running the request a second time.
export type ActionLogEntry =
  | {
      kind: "request";
      method: string;
      url: string;
      status: number | null;
      refused: boolean;
      requestHeaders?: Record<string, string>;
      requestBody?: string;
      response?: LoggedResponse;
    }
  | { kind: "draft"; method: string; url: string }
  | { kind: "assertions"; count: number }
  | { kind: "variable"; name: string }
  | { kind: "code"; method: string; path: string; layers: number }
  | { kind: "instruction"; text: string };

// the shape the frontend's ResponseViewer already knows how to render
interface LoggedResponse {
  status: number;
  statusText: string;
  headers: Record<string, any>;
  data: any;
  timing: { total: number; ttfb: number; download: number };
  size: number;
  sizeSource: "content-length" | "measured";
  serverTiming?: any[];
  // set when the payload was too big to carry back, so the ui can say so
  // instead of presenting a cut off body as the whole response
  truncated?: boolean;
}

// a local dev endpoint rarely returns more than this. past it the reply itself
// becomes the problem, so the body is dropped rather than silently halved.
const LOG_BODY_LIMIT = 200_000;

// a request the agent drafted into a tab, or checks it added, for the frontend
// to apply. these are the only things the agent can write into the workspace.
export type UiAction =
  | {
      type: "create_request";
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
      label: string;
    }
  | { type: "create_assertions"; assertions: { field: string; operator: string; value: string }[] }
  | { type: "set_variable"; name: string; value: string }
  | { type: "remember_instruction"; text: string }
  // generated source, for the code view to show. it is read-only output: the
  // app has no path that writes to the user's files.
  | { type: "generated_code"; generated: GeneratedEndpoint };

// a model that is not happy with its first attempt calls the tool again with a
// fuller version instead of replacing it, and both would be applied. matching
// on content within one turn collapses those retries.
export function createRequest(args: any, uiActions: UiAction[], log: ActionLogEntry[] = []) {
  const method = String(args.method || "GET").toUpperCase();
  const url = String(args.url || "");

  if (!url) return { error: "url is required" };

  const headers = parseJsonArg(args.headers);
  // the tab keeps the body as text for the user to edit, so anything that is
  // json comes back out formatted. the model usually sends it on one line,
  // which is unreadable in the body editor.
  const body = formatBody(args.body);

  const already = uiActions.some(
    (a) => a.type === "create_request" && a.method === method && a.url === url && a.body === body
  );

  if (already) {
    return {
      ok: true,
      duplicate: true,
      message: `That tab is already open from an earlier call this turn, so nothing was added. Do not call create_request for it again.`,
    };
  }

  uiActions.push({
    type: "create_request",
    method,
    url,
    headers: headers && typeof headers === "object" ? headers : {},
    body,
    label: String(args.label || `${method} ${url.replace(/^https?:\/\/[^/]+/, "")}`),
  });
  log.push({ kind: "draft", method, url });

  return {
    ok: true,
    message: `A tab was opened with ${method} ${url} filled in. It has not been sent. Tell the user it is ready for them to review and send.`,
  };
}

export function createAssertions(args: any, uiActions: UiAction[], log: ActionLogEntry[] = []) {
  const parsed = parseJsonArg(args.assertions);

  if (!Array.isArray(parsed)) {
    return { error: "assertions must be a JSON array string. Nothing was added." };
  }

  // everything already queued this turn, so a second call that repeats its
  // first attempt only contributes what is new
  const seen = new Set(
    uiActions
      .filter((a): a is Extract<UiAction, { type: "create_assertions" }> =>
        a.type === "create_assertions"
      )
      .flatMap((a) => a.assertions.map((x) => `${x.field}|${x.operator}|${x.value}`))
  );

  const accepted: { field: string; operator: string; value: string }[] = [];
  const rejected: string[] = [];
  const rewritten: string[] = [];
  let duplicates = 0;

  for (const item of parsed) {
    const raw = String(item?.field ?? "").trim();
    const operator = String(item?.operator ?? "").trim().toLowerCase();

    if (!raw) {
      rejected.push("an assertion with no field");
      continue;
    }
    if (!ASSERTION_OPERATORS.includes(operator)) {
      rejected.push(`${raw}: unsupported operator "${item?.operator}"`);
      continue;
    }

    const normalised = normaliseField(raw);
    if (!normalised) {
      rejected.push(
        `${raw}: fields must start with one of ${ASSERTION_ROOTS.join(", ")}`
      );
      continue;
    }
    if (normalised.note) rewritten.push(normalised.note);

    const value = item?.value === undefined || item?.value === null ? "" : String(item.value);
    const key = `${normalised.field}|${operator}|${value}`;

    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    accepted.push({ field: normalised.field, operator, value });
  }

  if (accepted.length === 0) {
    if (duplicates > 0 && rejected.length === 0) {
      return {
        ok: true,
        duplicate: true,
        message: `All ${duplicates} of those are already on the tab from an earlier call this turn. Nothing was added. Do not send them again.`,
      };
    }
    return {
      error: `No assertions were added. Rejected: ${rejected.join("; ")}. Valid operators are ${ASSERTION_OPERATORS.join(", ")}.`,
    };
  }

  uiActions.push({ type: "create_assertions", assertions: accepted });
  log.push({ kind: "assertions", count: accepted.length });

  return {
    ok: true,
    added: accepted.length,
    rejected: rejected.length ? rejected : undefined,
    rewritten: rewritten.length ? rewritten : undefined,
    skippedAsDuplicates: duplicates || undefined,
    message: `${accepted.length} assertion(s) added to the active tab. If that tab already has a response they have been checked against it, otherwise they run on the next send. Assertions accumulate, so send only new ones if you call this again.`,
  };
}

function setVariable(args: any, uiActions: UiAction[], log: ActionLogEntry[] = [], vars: Record<string, string> = {}) {
  const name = String(args.name ?? "").trim();
  const value = args.value === undefined || args.value === null ? "" : String(args.value);

  if (!VARIABLE_NAME.test(name)) {
    return {
      error: `"${name}" is not a usable variable name. Use letters, digits, underscore, dot or dash only.`,
    };
  }

  const already = uiActions.some((a) => a.type === "set_variable" && a.name === name);
  if (already) {
    return {
      ok: true,
      duplicate: true,
      message: `{{${name}}} was already set this turn. Do not set it again.`,
    };
  }

  uiActions.push({ type: "set_variable", name, value });
  log.push({ kind: "variable", name });
  // available to the rest of this turn, not just to the next one
  vars[name] = value;

  return {
    ok: true,
    message: `Saved as {{${name}}}. Every tab can use it now, so build later requests with {{${name}}} instead of pasting the value.`,
  };
}

// A rule that is already on the list costs nothing and is not saved twice. The
// comparison is on the text rather than on meaning, so two phrasings of the
// same idea both land — the user can switch one off, which is a better failure
// than the app deciding two sentences meant the same thing.
export function rememberInstruction(
  args: any,
  uiActions: UiAction[],
  log: ActionLogEntry[] = [],
  existing: Instruction[] = []
) {
  const text = String(args.text ?? "").trim().replace(/\s+/g, " ");

  if (!text) return { error: "text is required" };
  if (text.length > MAX_INSTRUCTION_CHARS) {
    return {
      error: `An instruction has to fit in ${MAX_INSTRUCTION_CHARS} characters. Say the rule, not the reasoning. Do not retry with the same text.`,
    };
  }

  const key = text.toLowerCase();
  const already =
    existing.some((i) => i.text.toLowerCase() === key) ||
    uiActions.some((a) => a.type === "remember_instruction" && a.text.toLowerCase() === key);

  if (already) {
    return {
      ok: true,
      duplicate: true,
      message: "That instruction is already saved, so nothing was added. Do not save it again.",
    };
  }

  if (existing.length >= MAX_INSTRUCTIONS) {
    return {
      error: `The workspace already holds the maximum of ${MAX_INSTRUCTIONS} instructions. Tell the user to remove one in the Instructions panel. Do not retry.`,
    };
  }

  uiActions.push({ type: "remember_instruction", text });
  log.push({ kind: "instruction", text });

  return {
    ok: true,
    message: `Saved. It will be followed from now on without being asked, and the user can see it in the Instructions panel. Do not repeat it back to them at length; a short acknowledgement is enough.`,
  };
}

// Two things come out of one generation: the code, which the user reads, and a
// request against the endpoint it describes, which lands in a tab like any
// scanned route. The tab is the point — code you cannot exercise is a wall of
// text — but it is drafted rather than sent, because the endpoint it points at
// does not exist until someone pastes the code in.
async function runGenerateCode(
  args: any,
  ctx: ToolCtx
): Promise<{ error: string } | Record<string, any>> {
  const description = String(args.description ?? "").trim();

  if (!description) return { error: "description is required" };
  if (!ctx.projectPath) {
    return {
      error:
        "No project folder is known, so there is no code to read a style from. Ask the user to press Scan Project first. Do not retry.",
    };
  }

  let generated: GeneratedEndpoint;
  // reading the project and writing three layers takes the better part of half
  // a minute, and a spinner that says "thinking" for all of it is the same
  // spinner as one that has hung
  if (ctx.note) ctx.note.text = "reading your project's style, then writing the code";
  try {
    // the same standing rules the chat follows, so code the agent writes and
    // code the user asks for directly do not come out in two different styles
    generated = await generateEndpoint(ctx.projectPath, description, ctx.instructions ?? []);
  } catch (err: any) {
    // Code that will not parse is the model slipping, not the project being
    // wrong — there is nothing for the developer to fix and nothing for them to
    // decide, so it is simply asked for again. Once: a second failure is a
    // pattern, and hiding a pattern behind retries is how a broken thing looks
    // merely slow.
    if (err?.name === "UnusableCode") {
      if (ctx.note) ctx.note.text = "that came back malformed — writing it again";
      try {
        generated = await generateEndpoint(
          ctx.projectPath,
          description,
          ctx.instructions ?? []
        );
      } catch (second: any) {
        return { error: `${second.message} Do not retry.` };
      }
    } else {
      return { error: `${err.message} Do not retry.` };
    }
  } finally {
    if (ctx.note) ctx.note.text = null;
  }

  ctx.uiActions.push({ type: "generated_code", generated });
  ctx.log.push({
    kind: "code",
    method: generated.method,
    path: generated.path,
    layers: generated.layers.length,
  });

  // the same flow a scanned route gets: a filled in tab waiting on Send
  if (ctx.baseUrl && generated.path) {
    createRequest(
      {
        method: generated.method,
        url: `${ctx.baseUrl.replace(/\/+$/, "")}${generated.path}`,
        headers: JSON.stringify(generated.request.headers || {}),
        body: generated.request.body === null ? "" : JSON.stringify(generated.request.body),
        label: `${generated.method} ${generated.path}`,
      },
      ctx.uiActions,
      // deliberately not the run log: the draft is part of this one action, and
      // logging it separately would read as two things having happened
      []
    );
  }

  return {
    ok: true,
    method: generated.method,
    path: generated.path,
    layers: generated.layers.map((l) => `${l.layer} -> ${l.path}`),
    styleReadFrom: generated.references.map((r) => r.path),
    notes: generated.notes,
    message: `The code is on screen in the code view, one tab per layer, and a ${generated.method} ${generated.path} tab is open for testing it once they have pasted it in. Nothing was written to their files. Summarise what you added in a sentence or two and mention anything in notes. Do not repeat the code itself, they can already see it.`,
  };
}

async function runSendRequest(
  args: any,
  allowWrites: boolean,
  log: ActionLogEntry[] = [],
  vars: Record<string, string> = {}
) {
  const method = String(args.method || "GET");
  const url = resolveVars(String(args.url || ""), vars);

  if (!url) {
    return { error: "url is required" };
  }

  if (!isAllowed(method, url, allowWrites)) {
    log.push({ kind: "request", method, url, status: null, refused: true });
    return {
      refused: true,
      error: `${method.toUpperCase()} is blocked because read-only mode is on. Report this to the user and continue with the endpoints you can test. Do not retry.`,
    };
  }

  // the wire gets the resolved values, the tab keeps the {{name}} it was
  // written with. a tab holding a raw token stops working when that token
  // expires; one holding {{token}} keeps working after the next login.
  const requestHeaders = parseJsonArg(resolveVars(String(args.headers ?? ""), vars));
  const requestBody = parseJsonArg(resolveVars(String(args.body ?? ""), vars));
  const writtenHeaders = parseJsonArg(String(args.headers ?? ""));
  const writtenBody = parseJsonArg(String(args.body ?? ""));

  const result = await forwardRequest({
    method,
    url,
    headers: requestHeaders,
    body: requestBody,
  });

  if (result.blocked) {
    log.push({ kind: "request", method, url, status: null, refused: true });
    return {
      refused: true,
      error: `${url} is outside the local network, which ReqFlow does not proxy. Tell the user and do not retry.`,
    };
  }

  const oversized = JSON.stringify(result.data ?? null).length > LOG_BODY_LIMIT;

  log.push({
    kind: "request",
    method,
    url,
    status: result.status,
    refused: false,
    requestHeaders:
      writtenHeaders && typeof writtenHeaders === "object" ? writtenHeaders : {},
    requestBody: formatBody(writtenBody ?? requestBody),
    response: {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      data: oversized ? null : result.data,
      timing: result.timing,
      size: result.size,
      sizeSource: result.sizeSource,
      serverTiming: result.serverTiming,
      truncated: oversized || undefined,
    },
  });

  return {
    status: result.status,
    statusText: result.statusText,
    timing: result.timing.total,
    ttfb: result.timing.ttfb,
    // named data, not body, to match the root that assertion fields read from.
    // sliced so long test runs do not blow up the context.
    data: JSON.stringify(result.data).slice(0, 4000),
  };
}

export interface ToolCtx {
  allowWrites: boolean;
  uiActions: UiAction[];
  log: ActionLogEntry[];
  // workspace variables the frontend already holds, plus any set this turn
  vars: Record<string, string>;
  // actions already spent in this conversation, earlier turns included
  used: number;
  // the folder the last scan read, which is where generated code gets its
  // style from. null until something has been scanned.
  projectPath?: string | null;
  // used to build a testable url for a generated endpoint
  baseUrl?: string | null;
  // what is happening right now, for the panel to show while a slow tool runs
  note?: RunNote;
  // the workspace's standing instructions, so a new one can be checked against
  // the ones already saved rather than piling up a second copy
  instructions?: Instruction[];
}

// What the panel says while a tool is running. A spinner that says "thinking"
// for twenty seconds is the same spinner as one that has hung, and the tools
// that take real time — a request over the network, a generation that reads the
// project — are exactly the ones worth naming.
function describeWork(call: ToolCall): string {
  const args: any = call.args || {};
  const short = (url: string) => String(url || "").replace(/^https?:\/\/[^/]+/, "") || "the endpoint";

  switch (call.name) {
    case "send_request":
      return `sending ${String(args.method || "GET").toUpperCase()} ${short(args.url)}`;
    case "create_request":
      return `opening a tab for ${String(args.method || "GET").toUpperCase()} ${short(args.url)}`;
    case "create_assertions":
      return "writing checks";
    case "set_variable":
      return `saving {{${String(args.name || "value")}}}`;
    case "generate_code":
      return "reading your project's style, then writing the code";
    case "remember_instruction":
      return "saving an instruction";
    default:
      return "working";
  }
}

export async function runTool(call: ToolCall, ctx: ToolCtx) {
  const args: any = call.args || {};

  // set before the work and cleared after, so the panel names what is happening
  // rather than leaving the developer to guess at a spinner
  if (ctx.note) ctx.note.text = describeWork(call);

  if (ctx.used >= MAX_ACTIONS_PER_CHAT) {
    return {
      error: `Action limit of ${MAX_ACTIONS_PER_CHAT} for this conversation is used up, so nothing was done. Stop calling tools, tell the user what you got through, and suggest they clear the chat to start a fresh budget.`,
    };
  }

  const before = ctx.log.length;
  let out: any;

  switch (call.name) {
    case "send_request":
      out = await runSendRequest(args, ctx.allowWrites, ctx.log, ctx.vars);
      break;
    case "create_request":
      out = createRequest(args, ctx.uiActions, ctx.log);
      break;
    case "create_assertions":
      out = createAssertions(args, ctx.uiActions, ctx.log);
      break;
    case "set_variable":
      out = setVariable(args, ctx.uiActions, ctx.log, ctx.vars);
      break;
    case "remember_instruction":
      out = rememberInstruction(args, ctx.uiActions, ctx.log, ctx.instructions ?? []);
      break;
    case "generate_code":
      out = await runGenerateCode(args, ctx);
      break;
    default:
      return { error: `unknown tool ${call.name}. Do not retry.` };
  }

  if (ctx.note) ctx.note.text = null;

  // only a call that actually did something spends budget. a duplicate that
  // was collapsed, or a call rejected for a bad field, costs nothing.
  if (ctx.log.length > before) {
    ctx.used++;
    out.actionsRemaining = MAX_ACTIONS_PER_CHAT - ctx.used;
  }

  return out;
}

router.post("/", async (req: Request, res: Response) => {
  const { message, routeContext, history, allowWrites, baseUrl, actionsUsed, activeTab, variables, runId, projectPath, instructions } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  // autonomous by default. read-only is something the user opts into, not the
  // starting position, so anything other than an explicit false means writes.
  const writesEnabled = allowWrites !== false;

  // "why is this failing" is about the tab on screen, so the agent is shown it
  // rather than having to spend an action rediscovering it
  const tabContext = describeActiveTab(activeTab);

  // the frontend holds the real values; the agent only needs them to resolve
  // {{name}} in requests it sends itself
  const incomingVars: Record<string, string> = {};
  if (variables && typeof variables === "object") {
    for (const [k, v] of Object.entries(variables)) {
      if (VARIABLE_NAME.test(k)) incomingVars[k] = String(v);
    }
  }

  // an empty scan is the case where the agent invents plausible looking urls,
  // so it gets told to ask rather than guess
  const hasRoutes = typeof routeContext === "string" && /\b(GET|POST|PUT|PATCH|DELETE)\s+\//.test(routeContext);

  // held by the frontend and sent with each call, so the list the user can see
  // and switch off in the Instructions panel is the same list the model gets
  const standingInstructions = coerceInstructions(instructions);

  const alreadyUsed = Number.isFinite(actionsUsed) ? Math.max(0, Number(actionsUsed)) : 0;
  const budgetLeft = Math.max(0, MAX_ACTIONS_PER_CHAT - alreadyUsed);

  const provider = getProvider("chat");

  try {
    const systemPrompt = `You are an AI assistant built into ReqFlow, an API client that a developer runs on their own machine. It works like Postman or Insomnia: the developer points it at their own dev server and exercises their own endpoints. Sending requests to those endpoints is the normal, expected function of this tool, not an intrusion.

send_request performs real HTTP requests from the ReqFlow backend, which runs locally, so localhost and private addresses are reachable. When the user asks you to test their endpoints, call send_request for each one and report the real results. Do not decline local or private addresses, and do not ask the user to run the requests themselves. If a specific call genuinely looks destructive, skip that one and say why, but still test the rest.

create_request opens a pre-filled tab in the user's UI without sending anything. Use it when the user asks you to set up, prepare, draft or "open a request" they want to look over and send themselves. Do not follow it with send_request unless they also asked you to run it.

create_assertions adds checks to the Tests panel of the user's active tab. Use it when they ask for tests or checks on a response. Base the fields on a response you actually saw when you have one.

generate_code writes the source for an endpoint that does not exist yet, in the style of the project's own files, and shows it to the user. Use it when they ask you to implement, add, build or write an endpoint. Pass their request through in full: the description you send is the only thing the generator sees, so a one word summary produces one word's worth of code. Call it once per endpoint.

You cannot put that code into their files. They apply it themselves from the code view, after reading a diff of every file it would change, and ReqFlow then runs the endpoint and reads it back for them. So do not say the files have changed, and do not offer to change them: say the code is on screen, ready for them to review and apply. Until they do, the endpoint does not exist on the server, so do not follow generate_code with send_request to "check" it. That is a guaranteed 404 and a wasted action.

Choose by intent: "what happens if..." or "test this" means send_request, "set up" or "write me tests" means the create_ tools, "add an endpoint that..." means generate_code. Only send_request touches the network, so everything else works in read-only mode.

Act on the user's request directly. Do not ask for permission before calling a tool and do not describe what you are about to do and wait: they see a log of every action underneath your reply, so just do the work and report what happened.

When the user asks for all of something, every endpoint or the whole list, finish it in this reply. Working through four of fourteen and offering to continue is not what they asked for, and while you still have actions left there is nothing to ask about. Stop early only when you are actually blocked, for instance when a path needs an id you have no way to obtain, and then say which ones you could not reach and why.

${tabContext}

You have ${budgetLeft} of ${MAX_ACTIONS_PER_CHAT} actions left in this conversation. Spend them on what was asked rather than exploring, and if you run out, say what you finished and what is left.

set_variable stores a value the user can reuse as {{name}} in any tab. Nothing is sent by it either.

remember_instruction saves a standing rule so the user stops repeating it. Call it when they state one, then carry on with what they actually asked for in the same reply rather than stopping to confirm.

${formatInstructions(standingInstructions)}

A 401 or 403 is an instruction, not a result. If a request comes back with one, log in and send that same request again before saying anything about it — reporting "it returned 401" when you were holding the means to authenticate is reporting your own omission as the endpoint's behaviour. Say afterwards that you had to log in, and which endpoint needed it.

When endpoints need auth, call the login endpoint first and read the token out of the response body. Then call set_variable to save it as {{token}}, and from that point build Authorization headers as "Bearer {{token}}" rather than pasting the raw token. That way the user's tabs keep working after you are done, instead of each one holding its own copy that expires.

That is a rule about the requests you build, not about what you say. Asked for the token itself, print the value you read out of the login response. Answering "the JWT is {{token}}" tells them the name of a box they already knew about, not what is in it.

${writesEnabled
  ? "Write requests are enabled. Still avoid destructive calls like DELETE unless the user asked for them explicitly."
  : "Read-only mode is on: send_request only works for GET and login. If a test needs a write, say so instead of retrying, or offer to draft it with create_request so the user can send it themselves."}

${baseUrl
  ? `The API under test is at ${baseUrl}. Every scanned route below is relative to that origin, so build urls as ${baseUrl} followed by the path. Copy it exactly, scheme included: writing https when it says http points at a port that is not listening, and a local dev server almost never speaks https. Never guess a different host or port. If a route returns html instead of json, say the origin looks wrong rather than concluding the project is misconfigured.`
  : "No base url was supplied. Ask which host and port to use rather than guessing one."}

${hasRoutes
  ? `These are the routes ReqFlow found in the user's project. Each one may come with the parameters it takes and a body read out of the code's own validators. That body is what the endpoint requires, not a suggestion: send those field names. Inventing your own, username where the code says email, spends an action to be told so in a 400.

A create endpoint often has a value that has to be unique, an email, a username, a slug. The example body shows the shape, not a value to send verbatim: vary that field each time, for instance dev+7421@example.com rather than dev@example.com, or the second run of the same test always fails. If one does come back saying the value already exists, that is your input rather than a broken endpoint, so change it and send again instead of reporting a failure.

Use these paths exactly as written, prefixes included. Do not shorten or invent one: if the list says /api/incidents, then /incidents is a different, wrong url. This applies to every url you build, not just the one the user named. If you need a login endpoint to get a token and no login route appears in this list, say so and ask, rather than trying /api/login or any other guess. A url that is not in this list is a wasted action.
${routeContext}`
  : `No project has been scanned, so you do not know a single real path on this server. Guessing one wastes an action and leaves the user with a tab pointing at an endpoint that does not exist. Do not try /health, /api/users or any other common looking url. Ask them to press Scan Project first, or to tell you the exact path they want, and call send_request only once you have one.`}

Keep answers concise. After testing, summarise results compactly, one line per endpoint with method, path, status and timing, and call out anything that looks wrong.`;

    // trace is the visible record of everything the agent did. uiActions is the
    // separate mechanism the frontend applies. keeping them apart is what stops
    // a drafted tab being rendered as though it had been sent.
    const ctx: ToolCtx = {
      allowWrites: writesEnabled,
      uiActions: [],
      log: [],
      vars: incomingVars,
      used: alreadyUsed,
      instructions: standingInstructions,
      projectPath: typeof projectPath === "string" && projectPath.trim() ? projectPath.trim() : null,
      baseUrl: typeof baseUrl === "string" ? baseUrl : null,
      note: { text: null },
    };

    // both are shared by reference, so a push to the log or a note set mid-tool
    // is visible to the next poll
    publishRun(runId, ctx.log, ctx.note!);

    const chat = provider.startChat({
      system: systemPrompt,
      history: (history || []).map((h: any) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: String(h.content ?? ""),
      })),
      tools: [
        sendRequestTool,
        createRequestTool,
        createAssertionsTool,
        setVariableTool,
        generateCodeTool,
        rememberInstructionTool,
      ],
      // An embedded model runs the tools itself, inside llama.cpp's own loop,
      // so it is handed the same runTool the round-trip loop below calls. Both
      // paths spend the same action budget and write the same trace; only who
      // drives the loop differs.
      runTool: (call) => runTool(call, ctx),
    });

    const signal = beginRun(runId);
    let reply = await sendWithRetry(() => chat.send(message));

    // a failure part way through must not throw away the work already done.
    // by round eight the agent may have logged in, saved a token and tested
    // half the project; the actions are spent either way.
    let interrupted: string | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (reply.calls.length === 0) break;

      // Between rounds, and before running the next set of tools: everything up
      // to here has finished, and nothing after it has begun. Stopping anywhere
      // else would leave a tool half done.
      if (signal?.aborted) {
        interrupted = "Stopped. Everything above already happened.";
        break;
      }

      const results: ToolResult[] = [];
      for (const call of reply.calls) {
        results.push({ name: call.name, response: await runTool(call, ctx) });
      }

      if (signal?.aborted) {
        interrupted = "Stopped. Everything above already happened.";
        break;
      }

      try {
        reply = await sendWithRetry(() => chat.sendToolResults(results));
      } catch (err: any) {
        interrupted = readableModelError(err);
        break;
      }
    }

    res.json({
      response: interrupted
        ? `${interrupted}${ctx.log.length ? "" : " Nothing was sent."}`
        : reply.text,
      trace: ctx.log,
      uiActions: ctx.uiActions,
      actionsUsed: ctx.used,
      actionsRemaining: MAX_ACTIONS_PER_CHAT - ctx.used,
      actionLimit: MAX_ACTIONS_PER_CHAT,
      // what actually reached the prompt, so the checklist on screen is a
      // record rather than the frontend's assumption about what was sent
      // reported back so the panel can mark a rule as having reached the model.
      // that is a claim about what was sent, and switched-off rules never make
      // it this far — coerceInstructions drops them.
      instructionsUsed: standingInstructions.map((i) => i.id),
    });

    if (runId) runs.delete(runId);
    endRun(runId);
  } catch (err: any) {
    console.error("ai chat error:", err.message);
    res.status(500).json({ error: readableModelError(err) });
  }
});

export default router;
