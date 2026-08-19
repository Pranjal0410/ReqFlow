import { recentEndpoints } from "../recent";

const hit = (method: string, url: string, status: number, id: string) =>
  ({ id, method, url, status, timing: 1, at: 1 }) as any;

// This listed the last three requests, so sending one endpoint three times filled
// the list with three copies of it and pushed everything else out. What a
// developer comes back to is an endpoint, not a send.
describe("recentEndpoints", () => {
  it("shows an endpoint once, however often it was sent", () => {
    const history = [
      hit("GET", "http://h/api/users", 200, "3"),
      hit("GET", "http://h/api/users", 500, "2"),
      hit("GET", "http://h/api/users", 200, "1"),
    ];
    expect(recentEndpoints(history, 3)).toHaveLength(1);
  });

  it("keeps the most recent hit of each, which is the one worth showing", () => {
    const history = [
      hit("GET", "http://h/api/users", 500, "newest"),
      hit("GET", "http://h/api/users", 200, "older"),
    ];
    expect(recentEndpoints(history, 3)[0].id).toBe("newest");
  });

  it("puts the most recently hit endpoint at the top", () => {
    const history = [
      hit("POST", "http://h/api/login", 200, "b"),
      hit("GET", "http://h/api/users", 200, "a"),
    ];
    expect(recentEndpoints(history, 3).map((h) => h.id)).toEqual(["b", "a"]);
  });

  it("ignores the query string, since that is one endpoint", () => {
    const history = [
      hit("GET", "http://h/api/users?page=2", 200, "2"),
      hit("GET", "http://h/api/users", 200, "1"),
    ];
    expect(recentEndpoints(history, 3)).toHaveLength(1);
  });

  it("treats a different method as a different endpoint", () => {
    const history = [
      hit("POST", "http://h/api/users", 201, "2"),
      hit("GET", "http://h/api/users", 200, "1"),
    ];
    expect(recentEndpoints(history, 3)).toHaveLength(2);
  });

  it("stops at the limit", () => {
    const history = ["a", "b", "c", "d"].map((n) => hit("GET", `http://h/${n}`, 200, n));
    expect(recentEndpoints(history, 3)).toHaveLength(3);
  });
});
