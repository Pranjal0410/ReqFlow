import axios, { AxiosError } from "axios";
import { ProxyRequest, ProxyResponse } from "../types";
import { isPrivateTarget, TARGET_BLOCKED_MESSAGE } from "./targetGuard";
import { parseServerTiming } from "./serverTiming";

function emptyTiming(total: number) {
  return { total, ttfb: 0, download: 0 };
}

export async function forwardRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const start = Date.now();

  // enforced here rather than in the route, because the AI agent's
  // send_request tool calls this function directly and would otherwise
  // sidestep a check that only lived in the route handler
  if (!isPrivateTarget(req.url)) {
    return {
      status: 0,
      statusText: "blocked",
      headers: {},
      data: { error: TARGET_BLOCKED_MESSAGE },
      timing: emptyTiming(0),
      size: 0,
      sizeSource: "measured",
      serverTiming: [],
      blocked: true,
    };
  }

  try {
    // streaming lets us separate the wait for the first byte from the time
    // spent reading the body, instead of inventing a split of the total
    const response = await axios({
      method: req.method.toLowerCase(),
      url: req.url,
      headers: req.headers || {},
      data: req.body || undefined,
      timeout: 30000,
      responseType: "stream",
      validateStatus: () => true, // don't throw on 4xx/5xx
      // the check above only sees the url we were handed. without this a local
      // server could 302 us straight back out to a public address, which is the
      // same relay the guard exists to prevent.
      beforeRedirect: (options: any) => {
        const next = options.href || `${options.protocol}//${options.host}${options.path}`;
        if (!isPrivateTarget(next)) {
          throw new Error(`redirect to ${next} refused: ${TARGET_BLOCKED_MESSAGE}`);
        }
      },
    });

    const ttfb = Date.now() - start;

    const chunks: Buffer[] = [];
    let measured = 0;
    await new Promise<void>((resolve, reject) => {
      response.data.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        measured += chunk.length;
      });
      response.data.on("end", () => resolve());
      response.data.on("error", (e: Error) => reject(e));
    });

    const total = Date.now() - start;
    const raw = Buffer.concat(chunks).toString("utf8");

    const contentType = String(response.headers["content-type"] || "");
    let data: any = raw;
    if (contentType.includes("json")) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw; // server claimed json and sent something else
      }
    }

    // content-length is what actually crossed the wire, which is smaller than
    // the parsed body when the response was compressed. fall back to the bytes
    // we read when the server used chunked encoding and sent no header.
    const declared = Number(response.headers["content-length"]);
    const hasDeclared = Number.isFinite(declared) && declared >= 0;

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, any>,
      data,
      timing: { total, ttfb, download: Math.max(total - ttfb, 0) },
      size: hasDeclared ? declared : measured,
      sizeSource: hasDeclared ? "content-length" : "measured",
      serverTiming: parseServerTiming(response.headers["server-timing"]),
    };
  } catch (err) {
    const total = Date.now() - start;
    const axiosErr = err as AxiosError;

    return {
      status: axiosErr.response?.status || 0,
      statusText: axiosErr.message || "request failed",
      headers: {},
      data: { error: axiosErr.message },
      timing: emptyTiming(total),
      size: 0,
      sizeSource: "measured",
      serverTiming: [],
    };
  }
}
