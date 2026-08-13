import { applyPathParams, namesIn, unfilled } from "../pathParams";

// a scanned route arrives as /api/incidents/:id, and that url is useless until
// something fills it in
describe("namesIn", () => {
  it("finds the placeholders", () => {
    expect(namesIn("http://x/api/incidents/:id/notes")).toEqual(["id"]);
    expect(namesIn("http://x/a/:userId/b/:postId")).toEqual(["userId", "postId"]);
  });

  it("does not mistake a port for a placeholder", () => {
    expect(namesIn("http://localhost:3001/api/incidents")).toEqual([]);
    expect(namesIn("http://localhost:3001/api/x/:id")).toEqual(["id"]);
  });

  it("lists a repeated name once", () => {
    expect(namesIn("http://x/:id/y/:id")).toEqual(["id"]);
  });
});

describe("applyPathParams", () => {
  it("substitutes a value", () => {
    expect(applyPathParams("http://x/api/incidents/:id", { id: "42" })).toBe(
      "http://x/api/incidents/42"
    );
  });

  it("leaves the port alone", () => {
    expect(applyPathParams("http://localhost:3001/a/:id", { id: "7" })).toBe(
      "http://localhost:3001/a/7"
    );
  });

  it("leaves an unfilled placeholder visible rather than producing a double slash", () => {
    expect(applyPathParams("http://x/a/:id/notes", {})).toBe("http://x/a/:id/notes");
  });

  it("encodes a value that would otherwise change the path", () => {
    expect(applyPathParams("http://x/a/:id", { id: "a/b" })).toBe("http://x/a/a%2Fb");
  });

  it("fills every occurrence of the same name", () => {
    expect(applyPathParams("http://x/:id/y/:id", { id: "9" })).toBe("http://x/9/y/9");
  });
});

describe("unfilled", () => {
  it("reports only what is still empty", () => {
    const url = "http://x/:a/:b";
    expect(unfilled(url, { a: "1" })).toEqual(["b"]);
    expect(unfilled(url, { a: "1", b: "2" })).toEqual([]);
  });
});
