import { autoTestsFor, autoTestsForRoutes } from "../autoTests";
import { DetectedRoute } from "../../types";

function route(method: string, path: string, body: any = null): DetectedRoute {
  return { method, path, description: "", params: [], body };
}

describe("autoTestsFor", () => {
  it("asserts 201 for a create, with no body on the route to check further", () => {
    const tests = autoTestsFor(route("POST", "/users"));
    expect(tests).toEqual([{ id: expect.any(String), field: "status", operator: "equals", value: "201", passed: null }]);
  });

  it("asserts 200 rather than 201 for a login-shaped POST", () => {
    const tests = autoTestsFor(route("POST", "/auth/login", { email: "x" }));
    expect(tests[0]).toMatchObject({ field: "status", value: "200" });
  });

  it("asserts 200 for a GET", () => {
    const tests = autoTestsFor(route("GET", "/users/:id"));
    expect(tests[0]).toMatchObject({ field: "status", value: "200" });
  });

  it("adds a data-exists check when the scan saw a body come in", () => {
    const tests = autoTestsFor(route("POST", "/users", { name: "x" }));
    expect(tests).toHaveLength(2);
    expect(tests[1]).toMatchObject({ field: "data", operator: "exists" });
  });
});

describe("autoTestsForRoutes", () => {
  it("keys each route's tests by its routeKey", () => {
    const out = autoTestsForRoutes([route("GET", "/users"), route("POST", "/users", { name: "x" })]);
    expect(Object.keys(out)).toEqual(["GET /users", "POST /users"]);
    expect(out["POST /users"]).toHaveLength(2);
  });
});
