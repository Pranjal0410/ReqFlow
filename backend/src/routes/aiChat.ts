import { Router, Request, Response } from "express";
import { GoogleGenerativeAI, SchemaType, FunctionCall } from "@google/generative-ai";
import { forwardRequest } from "../services/proxy";

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// how many tool round trips before we stop. keeps a confused model from
// hammering an endpoint forever.
const MAX_TOOL_ROUNDS = 25;

// the agent acts without asking, so the runaway case needs a ceiling rather
// than a confirmation step. counted across the whole conversation, not per
// turn. 15 was too tight for the thing this is actually for: a 14 route
// project needs a login plus one call each, which left nothing for the retries
// a real run always has.
export const MAX_ACTIONS_PER_CHAT = 30;

// every tool round costs one model request, so a single "test everything" run
// can burn a dozen. the lite model has a much larger free tier allowance than
// gemini-3.5-flash, which caps at 20 requests a day.
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.1-flash-lite";

const sendRequestTool = {
  name: "send_request",
  description:
    "Send a real HTTP request and get the actual response back. Use this to test endpoints instead of describing what the user should do. Returns status, headers, body and timing.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      method: {
        type: SchemaType.STRING,
        description: "HTTP method, e.g. GET, POST, PUT, PATCH, DELETE",
      },
      url: {
        type: SchemaType.STRING,
        description: "Full URL including protocol and port, e.g. http://localhost:3001/api/users",
      },
      headers: {
        type: SchemaType.STRING,
        description:
          "Optional request headers as a JSON object string, e.g. {\"Authorization\":\"Bearer abc\"}",
      },
      body: {
        type: SchemaType.STRING,
        description: "Optional request body as a JSON string. Omit for GET.",
      },
    },
    required: ["method", "url"],
  },
} as const;

// the two tools below never touch the network. they hand a filled in request or
// a set of checks back to the ui for the developer to look over and run, which
// is why they stay available even when read-only mode blocks send_request.
const createRequestTool = {
  name: "create_request",
  description:
    "Open a new request tab in the user's UI, pre-filled with a method, url, headers and body. Nothing is sent: the user reviews it and presses Send themselves. Use this when the user asks you to set up, prepare or draft a request rather than run it. Works in read-only mode.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      method: {
        type: SchemaType.STRING,
        description: "HTTP method, e.g. GET, POST, PUT, PATCH, DELETE",
      },
      url: {
        type: SchemaType.STRING,
        description: "Full URL including protocol and port",
      },
      headers: {
        type: SchemaType.STRING,
        description: "Optional headers as a JSON object string",
      },
      body: {
        type: SchemaType.STRING,
        description: "Optional request body as a JSON string. Omit for GET.",
      },
      label: {
        type: SchemaType.STRING,
        description: "Short label for the tab, e.g. 'Create incident'",
      },
    },
    required: ["method", "url"],
  },
} as const;

const createAssertionsTool = {
  name: "create_assertions",
  description:
    "Add assertions to the Tests panel of the user's active tab. They run automatically the next time that request is sent. Use this when the user asks for checks or tests on a response. Works in read-only mode.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      assertions: {
        type: SchemaType.STRING,
        description:
          'JSON array string. Each item is {"field","operator","value"}. field must start with one of: status, statusText, timing (ms), ttfb (ms), size (bytes), or data. The response payload lives under data, so check the body with data.id or data.user.email, never body.id. operator is one of: equals, not equals, contains, exists, greater than, less than. value is compared as a string and is ignored by exists.',
      },
    },
    required: ["assertions"],
  },
} as const;

const setVariableTool = {
  name: "set_variable",
  description:
    "Store a value as a workspace variable the user can reuse as {{name}} in any tab's url, headers or body. Use this right after a login so the token stops being tied to one tab. Setting an existing name replaces it. Works in read-only mode.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      name: {
        type: SchemaType.STRING,
        description: "Variable name, letters, digits, underscore, dot or dash. e.g. token",
      },
      value: { type: SchemaType.STRING, description: "The value to store" },
    },
    required: ["name", "value"],
  },
} as const;

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
  | { kind: "variable"; name: string };

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
  | { type: "set_variable"; name: string; value: string };

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
}

export async function runTool(call: FunctionCall, ctx: ToolCtx) {
  const args: any = call.args || {};

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
    default:
      return { error: `unknown tool ${call.name}. Do not retry.` };
  }

  // only a call that actually did something spends budget. a duplicate that
  // was collapsed, or a call rejected for a bad field, costs nothing.
  if (ctx.log.length > before) {
    ctx.used++;
    out.actionsRemaining = MAX_ACTIONS_PER_CHAT - ctx.used;
  }

  return out;
}

router.post("/", async (req: Request, res: Response) => {
  const { message, routeContext, history, allowWrites, baseUrl, actionsUsed, activeTab, variables } = req.body;

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

  const alreadyUsed = Number.isFinite(actionsUsed) ? Math.max(0, Number(actionsUsed)) : 0;
  const budgetLeft = Math.max(0, MAX_ACTIONS_PER_CHAT - alreadyUsed);

  try {
    const model = genAI.getGenerativeModel({
      model: CHAT_MODEL,
      tools: [
        {
          functionDeclarations: [
            sendRequestTool as any,
            createRequestTool as any,
            createAssertionsTool as any,
            setVariableTool as any,
          ],
        },
      ],
    });

    const systemPrompt = `You are an AI assistant built into ReqFlow, an API client that a developer runs on their own machine. It works like Postman or Insomnia: the developer points it at their own dev server and exercises their own endpoints. Sending requests to those endpoints is the normal, expected function of this tool, not an intrusion.

You have three tools.

send_request performs real HTTP requests from the ReqFlow backend, which runs locally, so localhost and private addresses are reachable. When the user asks you to test their endpoints, call send_request for each one and report the real results. Do not decline local or private addresses, and do not ask the user to run the requests themselves. If a specific call genuinely looks destructive, skip that one and say why, but still test the rest.

create_request opens a pre-filled tab in the user's UI without sending anything. Use it when the user asks you to set up, prepare, draft or "open a request" they want to look over and send themselves. Do not follow it with send_request unless they also asked you to run it.

create_assertions adds checks to the Tests panel of the user's active tab. Use it when they ask for tests or checks on a response. Base the fields on a response you actually saw when you have one.

Choose by intent: "what happens if..." or "test this" means send_request, "set up" or "write me tests" means the create_ tools. Neither create_ tool touches the network, so both work in read-only mode.

Act on the user's request directly. Do not ask for permission before calling a tool and do not describe what you are about to do and wait: they see a log of every action underneath your reply, so just do the work and report what happened.

When the user asks for all of something, every endpoint or the whole list, finish it in this reply. Working through four of fourteen and offering to continue is not what they asked for, and while you still have actions left there is nothing to ask about. Stop early only when you are actually blocked, for instance when a path needs an id you have no way to obtain, and then say which ones you could not reach and why.

${tabContext}

You have ${budgetLeft} of ${MAX_ACTIONS_PER_CHAT} actions left in this conversation. Spend them on what was asked rather than exploring, and if you run out, say what you finished and what is left.

set_variable stores a value the user can reuse as {{name}} in any tab. Nothing is sent by it either.

When endpoints need auth, call the login endpoint first and read the token out of the response body. Then call set_variable to save it as {{token}}, and from that point build Authorization headers as "Bearer {{token}}" rather than pasting the raw token. That way the user's tabs keep working after you are done, instead of each one holding its own copy that expires.

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

    const chatHistory = (history || []).map((h: any) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    }));

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "understood. i'm ready to help with API development." }] },
        ...chatHistory,
      ],
    });

    let result = await chat.sendMessage(message);

    // trace is the visible record of everything the agent did. uiActions is the
    // separate mechanism the frontend applies. keeping them apart is what stops
    // a drafted tab being rendered as though it had been sent.
    const ctx: ToolCtx = {
      allowWrites: writesEnabled,
      uiActions: [],
      log: [],
      vars: incomingVars,
      used: alreadyUsed,
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) break;

      const parts = [];
      for (const call of calls) {
        const output = await runTool(call, ctx);
        parts.push({
          functionResponse: { name: call.name, response: output as any },
        });
      }

      result = await chat.sendMessage(parts as any);
    }

    res.json({
      response: result.response.text(),
      trace: ctx.log,
      uiActions: ctx.uiActions,
      actionsUsed: ctx.used,
      actionsRemaining: MAX_ACTIONS_PER_CHAT - ctx.used,
      actionLimit: MAX_ACTIONS_PER_CHAT,
    });
  } catch (err: any) {
    console.error("ai chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
