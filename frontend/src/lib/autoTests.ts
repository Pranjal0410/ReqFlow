// A scanned route with no assertions on it is a request nobody has decided
// anything about — every one still needs at least a status check before "it
// ran" can become "it worked". Writing that by hand for every route the scan
// finds is the same three lines forty times, so this drafts the obvious ones
// instead: the status a route like this ought to answer with, and — when the
// scan saw a body coming in — that something comes back out.

import { DetectedRoute, TestCase } from "../types";
import { routeKey } from "./generatedRoutes";

function id(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function test(field: string, operator: string, value: string): TestCase {
  return { id: id(), field, operator, value, passed: null };
}

// a login or token exchange answers 200: it does not create anything, so 201
// would be the wrong thing to assert about the one POST that isn't a create
const AUTH_ACTION = /login|auth|token/i;

export function autoTestsFor(route: DetectedRoute): TestCase[] {
  const method = route.method.toUpperCase();
  const isCreate = method === "POST" && !AUTH_ACTION.test(route.path);
  const tests: TestCase[] = [test("status", "equals", isCreate ? "201" : "200")];

  // the scan saw this route take a body, which on a real API almost always
  // means it hands something back too — the created or fetched record
  if (route.body && typeof route.body === "object") {
    tests.push(test("data", "exists", ""));
  }

  return tests;
}

export function autoTestsForRoutes(routes: DetectedRoute[]): Record<string, TestCase[]> {
  const out: Record<string, TestCase[]> = {};
  for (const route of routes) {
    out[routeKey(route.method, route.path)] = autoTestsFor(route);
  }
  return out;
}
