import {
  addGenerated,
  pruneGenerated,
  isScanned,
  routeKey,
  toGeneratedRoute,
} from "../generatedRoutes";
import { DetectedRoute, GeneratedRoute } from "../../types";

const scanned = (method: string, path: string): DetectedRoute => ({
  method,
  path,
  description: "",
  params: [],
  body: null,
});

const draft = (method: string, url: string) => ({
  method,
  url,
  label: `${method} ${url}`,
});

describe("routeKey", () => {
  it("ignores the things that are not a difference", () => {
    expect(routeKey("get", "/users")).toBe(routeKey("GET", "/users"));
    expect(routeKey("GET", "/users/")).toBe(routeKey("GET", "/users"));
    expect(routeKey("GET", " /users ")).toBe(routeKey("GET", "/users"));
  });

  it("keeps the method apart from the path", () => {
    expect(routeKey("GET", "/users")).not.toBe(routeKey("POST", "/users"));
  });
});

describe("toGeneratedRoute", () => {
  it("takes the path off the url, which is what the sidebar reads", () => {
    const route = toGeneratedRoute(draft("POST", "http://localhost:3000/api/users"), "tab-1");

    expect(route).toMatchObject({ method: "POST", path: "/api/users", tabId: "tab-1" });
    // the whole url is kept: it is what reopens the request
    expect(route.url).toBe("http://localhost:3000/api/users");
  });

  it("drops a query string, which is not part of the endpoint", () => {
    expect(toGeneratedRoute(draft("GET", "http://localhost:3000/users?page=2"), "t").path).toBe(
      "/users"
    );
  });

  it("copes with a url nobody typed a scheme into", () => {
    expect(toGeneratedRoute(draft("GET", "localhost:3000/users"), "t").path).toBe("/users");
  });

  // a relative url has no host to eat the first segment, and reading it as one
  // turned "/orders/:id" into "/:id"
  it("reads a relative url as the path it is", () => {
    expect(toGeneratedRoute(draft("DELETE", "/orders/:id"), "t").path).toBe("/orders/:id");
    expect(toGeneratedRoute(draft("GET", "/orders?page=2"), "t").path).toBe("/orders");
  });
});

describe("addGenerated", () => {
  const routes = [scanned("GET", "/users")];

  it("lists an endpoint the project does not have", () => {
    const list = addGenerated([], toGeneratedRoute(draft("POST", "/orders"), "t1"), routes);

    expect(list.map((g) => g.path)).toEqual(["/orders"]);
  });

  // the agent opens tabs for endpoints that already exist too — "send a GET to
  // /users" — and listing those as missing would be a lie about the user's code
  it("does not list one the scan already found", () => {
    const list = addGenerated([], toGeneratedRoute(draft("GET", "/users"), "t1"), routes);

    expect(list).toEqual([]);
  });

  it("counts a different method on the same path as a different endpoint", () => {
    const list = addGenerated([], toGeneratedRoute(draft("POST", "/users"), "t1"), routes);

    expect(list.map((g) => g.method)).toEqual(["POST"]);
  });

  it("replaces an earlier draft of the same endpoint rather than stacking it", () => {
    const first = addGenerated([], toGeneratedRoute(draft("POST", "/orders"), "t1"), routes);
    const second = addGenerated(first, toGeneratedRoute(draft("POST", "/orders"), "t2"), routes);

    expect(second).toHaveLength(1);
    expect(second[0].tabId).toBe("t2");
  });
});

// Pasting the generated code into the project and scanning again is the point
// of the whole feature. At that moment the suggestion has become a real
// endpoint, and leaving it in the Generated list would say the opposite.
describe("pruneGenerated after a re-scan", () => {
  const list: GeneratedRoute[] = [
    toGeneratedRoute(draft("POST", "/orders"), "t1"),
    toGeneratedRoute(draft("DELETE", "/orders/:id"), "t2"),
  ];

  it("drops the ones the scan has caught up with", () => {
    const after = pruneGenerated(list, [scanned("GET", "/users"), scanned("POST", "/orders")]);

    expect(after.map((g) => g.path)).toEqual(["/orders/:id"]);
  });

  it("leaves everything alone when the scan found none of them", () => {
    expect(pruneGenerated(list, [scanned("GET", "/users")])).toHaveLength(2);
  });

  it("empties out once the project has all of them", () => {
    const after = pruneGenerated(list, [
      scanned("POST", "/orders"),
      scanned("DELETE", "/orders/:id"),
    ]);

    expect(after).toEqual([]);
  });

  // A filled-in path parameter is not the same string as the route that serves
  // it, so the match misses and the suggestion stays. Being told an endpoint is
  // still missing when it is not is the lesser of the two mistakes: the other
  // one is silently dropping code the user has not written yet.
  it("keeps a suggestion whose url had a real id in it", () => {
    const withId = [toGeneratedRoute(draft("GET", "http://localhost:3000/users/7"), "t3")];

    expect(pruneGenerated(withId, [scanned("GET", "/users/:id")])).toHaveLength(1);
  });
});

describe("isScanned", () => {
  it("is what both the adding and the pruning agree on", () => {
    const routes = [scanned("PATCH", "/users/:id")];

    expect(isScanned(routes, { method: "patch", path: "/users/:id/" })).toBe(true);
    expect(isScanned(routes, { method: "PUT", path: "/users/:id" })).toBe(false);
    expect(isScanned([], { method: "GET", path: "/users" })).toBe(false);
  });
});
