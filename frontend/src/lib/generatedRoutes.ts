import { DetectedRoute, GeneratedRoute } from "../types";
import { pathOf } from "./url";

// The agent can write an endpoint the project does not have yet, and opens a
// tab for it. Until this, that tab was the only trace: the sidebar lists what
// the scan found, and a route nobody has written into the project yet is not in
// there. So the work looked like nothing had happened.
//
// These are held apart from the scanned routes rather than mixed into them,
// because they are suggestions. A list that shows an endpoint the server does
// not serve, next to ones it does, with nothing to tell them apart, is worse
// than not showing it.

function normalisePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed || "/";
}

export function routeKey(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${normalisePath(path)}`;
}

// Whether the scan has since found this endpoint, which is what happens once
// the user pastes the generated code into their project. Compared on method and
// path: an agent that filled a path parameter in ("/users/7" against a scanned
// "/users/:id") does not match, and the suggestion stays listed rather than
// being quietly dropped on a guess.
export function isScanned(routes: DetectedRoute[], route: { method: string; path: string }): boolean {
  const key = routeKey(route.method, route.path);
  return routes.some((r) => routeKey(r.method, r.path) === key);
}

// Adds one, unless the scan already has it. The agent opens tabs for endpoints
// that do exist too — "send a GET to /users" — and listing those as things the
// project is missing would be a plain lie about the user's own code.
export function addGenerated(
  list: GeneratedRoute[],
  route: GeneratedRoute,
  routes: DetectedRoute[]
): GeneratedRoute[] {
  if (isScanned(routes, route)) return list;

  const key = routeKey(route.method, route.path);
  const without = list.filter((g) => routeKey(g.method, g.path) !== key);
  // the newest generation of an endpoint replaces the older one, and goes last
  // so the list reads in the order the agent produced it
  return [...without, route];
}

// Drops the ones the scan has caught up with. Called after a re-scan, so a
// suggestion the user has acted on stops being a suggestion.
export function pruneGenerated(
  list: GeneratedRoute[],
  routes: DetectedRoute[]
): GeneratedRoute[] {
  return list.filter((g) => !isScanned(routes, g));
}

// What the sidebar shows for a request the agent drafted. The url is kept whole
// for reopening the request, and the path taken off it for reading and for
// comparing against the scan.
export function toGeneratedRoute(
  draft: { method: string; url: string; label: string },
  tabId: string
): GeneratedRoute {
  return {
    method: draft.method.toUpperCase(),
    path: normalisePath(pathFromUrl(draft.url)),
    url: draft.url,
    label: draft.label,
    tabId,
  };
}

// pathOf() puts a scheme on anything without one, which reads a bare path as a
// hostname: "/orders/:id" came back as "/:id", the leading segment eaten as the
// host. The agent normally sends a whole url, but a relative one is the shape
// where being wrong is silent — the sidebar would just show the wrong endpoint.
function pathFromUrl(url: string): string {
  const text = url.trim();
  if (text.startsWith("/")) return text.split(/[?#]/)[0];
  return pathOf(text);
}
