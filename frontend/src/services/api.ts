import axios from "axios";
import { DetectedRoute, ApiResponse } from "../types";
import { CONFIG } from "../config";

const BASE = CONFIG.API_BASE;

export async function analyzeProject(projectPath: string): Promise<{
  routes: DetectedRoute[];
  filesScanned: number;
  // true when the backend still had this exact code from an earlier scan, so
  // the scan modal can say so instead of implying Gemini was asked again
  cached: boolean;
}> {
  const res = await axios.post(`${BASE}/analyze`, { projectPath });
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
  const res = await axios.post(`${BASE}/analyze/files`, { projectPath });
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
  const res = await axios.post(`${BASE}/proxy`, {
    method: "GET",
    url: origin,
    headers: {},
  });
  return typeof res.data?.status === "number" && res.data.status > 0;
}

export async function sendRequest(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: any
): Promise<ApiResponse> {
  const res = await axios.post(`${BASE}/proxy`, {
    method,
    url,
    headers,
    body,
  });
  return res.data;
}
// built from the routes the client already holds, so this costs no model call
export async function exportOpenApi(
  routes: DetectedRoute[],
  title: string,
  baseUrl: string
): Promise<string> {
  const res = await axios.post(`${BASE}/analyze/openapi`, { routes, title, baseUrl });
  return JSON.stringify(res.data, null, 2);
}
