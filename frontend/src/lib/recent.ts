import { HistoryEntry } from "../types";

// The endpoints most recently hit, one row each.
//
// The sidebar listed the last three *requests*, so sending one endpoint three
// times filled the list with three copies of it and pushed everything else out.
// What a developer comes back to is an endpoint, not a send — and once they are
// back on it, its body, its response and its previous runs are all in its tab.
//
// This lives here rather than in the component so it can be tested: Sidebar.tsx
// imports react-native, which the test runner will not load.
export function recentEndpoints(history: HistoryEntry[], limit: number): HistoryEntry[] {
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];

  for (const entry of history) {
    // the query string is not a different endpoint
    const key = `${entry.method} ${entry.url.split(/[?#]/)[0].replace(/\/+$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
