import axios, { AxiosError } from "axios";
import { ProxyRequest, ProxyResponse } from "../types";

export async function forwardRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const start = Date.now();

  try {
    const response = await axios({
      method: req.method.toLowerCase(),
      url: req.url,
      headers: req.headers || {},
      data: req.body || undefined,
      timeout: 30000,
      validateStatus: () => true, // don't throw on 4xx/5xx
    });

    const total = Date.now() - start;

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, any>,
      data: response.data,
      timing: { total },
    };
  } catch (err) {
    const total = Date.now() - start;
    const axiosErr = err as AxiosError;

    return {
      status: axiosErr.response?.status || 0,
      statusText: axiosErr.message || "request failed",
      headers: {},
      data: { error: axiosErr.message },
      timing: { total },
    };
  }
}