import { Router, Request, Response } from "express";
import { GoogleGenerativeAI, SchemaType, FunctionCall } from "@google/generative-ai";
import { forwardRequest } from "../services/proxy";

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// how many tool round trips before we stop. keeps a confused model from
// hammering an endpoint forever.
const MAX_TOOL_ROUNDS = 25;

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

function parseJsonArg(raw: unknown): any {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return undefined;
  }
}

// writes are off by default so the agent cannot create or mutate data on its
// own. login is the one exception, without it nothing behind auth is testable.
function isAllowed(method: string, url: string, allowWrites: boolean) {
  const m = method.toUpperCase();
  if (allowWrites || m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  if (m === "POST" && /\/(login|signin|token)\b/i.test(url)) return true;
  return false;
}

async function runTool(call: FunctionCall, allowWrites: boolean) {
  const args: any = call.args || {};
  const method = String(args.method || "GET");
  const url = String(args.url || "");

  if (!url) {
    return { error: "url is required" };
  }

  if (!isAllowed(method, url, allowWrites)) {
    return {
      refused: true,
      error: `${method.toUpperCase()} is blocked because read-only mode is on. Report this to the user and continue with the endpoints you can test. Do not retry.`,
    };
  }

  const result = await forwardRequest({
    method,
    url,
    headers: parseJsonArg(args.headers),
    body: parseJsonArg(args.body),
  });

  return {
    status: result.status,
    statusText: result.statusText,
    timingMs: result.timing.total,
    // keep the payload small so long test runs do not blow up the context
    body: JSON.stringify(result.data).slice(0, 4000),
  };
}

router.post("/", async (req: Request, res: Response) => {
  const { message, routeContext, history, allowWrites, baseUrl } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const writesEnabled = allowWrites === true;

  try {
    const model = genAI.getGenerativeModel({
      model: CHAT_MODEL,
      tools: [{ functionDeclarations: [sendRequestTool as any] }],
    });

    const systemPrompt = `You are an AI assistant built into ReqFlow, an API client that a developer runs on their own machine. It works like Postman or Insomnia: the developer points it at their own dev server and exercises their own endpoints. Sending requests to those endpoints is the normal, expected function of this tool, not an intrusion.

You have a send_request tool that performs real HTTP requests from the ReqFlow backend, which runs locally, so localhost and private addresses are reachable. When the user asks you to test their endpoints, call send_request for each one and report the real results. Do not decline local or private addresses, and do not ask the user to run the requests themselves. If a specific call genuinely looks destructive, skip that one and say why, but still test the rest.

When endpoints need auth, call the login endpoint first, read the token out of the response body, and pass it as an Authorization header on later calls.

${writesEnabled
  ? "Write requests are enabled. Still avoid destructive calls like DELETE unless the user asked for them explicitly."
  : "Read-only mode is on: only GET requests and login work. If a test needs a write, say so instead of retrying."}

${baseUrl
  ? `The API under test is at ${baseUrl}. Every scanned route below is relative to that origin, so build urls as ${baseUrl} followed by the path. Never guess a different host or port. If a route returns html instead of json, say the origin looks wrong rather than concluding the project is misconfigured.`
  : "No base url was supplied. Ask which host and port to use rather than guessing one."}

You have context about the user's project:
${routeContext || "No project scanned yet."}

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
    const trace: any[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) break;

      const parts = [];
      for (const call of calls) {
        const output = await runTool(call, writesEnabled);
        trace.push({
          method: (call.args as any)?.method,
          url: (call.args as any)?.url,
          status: (output as any).status ?? null,
          refused: (output as any).refused ?? false,
        });
        parts.push({
          functionResponse: { name: call.name, response: output as any },
        });
      }

      result = await chat.sendMessage(parts as any);
    }

    res.json({ response: result.response.text(), trace });
  } catch (err: any) {
    console.error("ai chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
