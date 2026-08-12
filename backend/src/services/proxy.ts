import axios, { AxiosError } from "axios";
import { ProxyRequest, ProxyResponse } from "../types";
import { isPrivateTarget, TARGET_BLOCKED_MESSAGE } from "./targetGuard";

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
    };
  }
}
