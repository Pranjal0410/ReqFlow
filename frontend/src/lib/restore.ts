import { GeneratedEndpoint, GeneratedRoute, RunRecord } from "../types";

// Reading back what a previous session saved.
//
// This lives apart from persist.ts so it can be tested: that file imports
// AsyncStorage, which pulls a native module into the test runner and is the
// reason none of this had tests before. Nothing here touches storage — it takes
// whatever was parsed out of the blob and decides what is safe to trust.

// Restored only when it is still a whole endpoint. A half-written entry would
// open a code view with nothing in it, which reads as the app having lost the
// code rather than as one record being unusable.
export function onlyRealCode(raw: any): Record<string, GeneratedEndpoint> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const kept: Record<string, GeneratedEndpoint> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    if (!value || typeof value !== "object") continue;
    if (typeof value.method !== "string" || typeof value.path !== "string") continue;
    if (!Array.isArray(value.layers) || value.layers.length === 0) continue;
    kept[key] = value as GeneratedEndpoint;
  }
  return kept;
}

// A drafted endpoint needs a method and a path to be listed at all.
export function onlyRealRoutes(raw: any): GeneratedRoute[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r: any) => r && typeof r.method === "string" && typeof r.path === "string"
  );
}

// A run without its phases would show an empty breakdown, and the breakdown is
// most of why the record is worth keeping.
export function onlyRealRuns(raw: any): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r: any) =>
      r && typeof r.method === "string" && typeof r.path === "string" && Array.isArray(r.phases)
  );
}
