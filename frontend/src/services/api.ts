import axios from "axios";
import { DetectedRoute, ApiResponse } from "../types";
import { CONFIG } from "../config";

const BASE = CONFIG.API_BASE;

export async function analyzeProject(projectPath: string): Promise<{
  routes: DetectedRoute[];
  filesScanned: number;
}> {
  const res = await axios.post(`${BASE}/analyze`, { projectPath });
  return res.data;
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