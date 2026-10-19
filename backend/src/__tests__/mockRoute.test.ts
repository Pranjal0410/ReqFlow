import { toPath } from "../routes/mock";

describe("toPath", () => {
  it("strips {{BASE_URL}} the same way an environment substitution would", () => {
    expect(toPath("{{BASE_URL}}/users/:id")).toBe("/users/:id");
  });

  it("strips a literal origin, for a project scanned before an environment existed", () => {
    expect(toPath("http://localhost:3001/api/auth/login")).toBe("/api/auth/login");
  });

  it("drops the query string either way", () => {
    expect(toPath("{{BASE_URL}}/users?active=true")).toBe("/users");
    expect(toPath("http://localhost:3001/users?active=true")).toBe("/users");
  });

  it("leaves an already-bare path alone", () => {
    expect(toPath("/users/:id")).toBe("/users/:id");
  });

  it("adds the leading slash a bare path is missing", () => {
    expect(toPath("users/:id")).toBe("/users/:id");
  });
});
