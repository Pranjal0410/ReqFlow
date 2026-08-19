import { applyPathParams, namesIn, unfilled, matchTemplate} from "../pathParams";

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

// The agent drafts a tab holding /api/incidents/:id/commander, and ReqFlow then
// runs that endpoint against a real record. Compared as strings those are two
// different urls, so the response landed in a new tab — or nowhere — while the
// drafted tab sat saying "No response yet" about a request just made for it.
describe("matchTemplate", () => {
  it("recognises the concrete url as that template, filled in", () => {
    expect(
      matchTemplate(
        "http://localhost:3001/api/incidents/:id/commander",
        "http://localhost:3001/api/incidents/6a7ed6be257d1d048d253b9d/commander"
      )
    ).toEqual({ id: "6a7ed6be257d1d048d253b9d" });
  });

  it("reads more than one parameter", () => {
    expect(
      matchTemplate("http://h/api/users/:userId/incidents/:id", "http://h/api/users/7/incidents/9")
    ).toEqual({ userId: "7", id: "9" });
  });

  it("refuses a url that is a different endpoint", () => {
    expect(matchTemplate("http://h/api/incidents/:id/commander", "http://h/api/incidents/7/notes"))
      .toBeNull();
    expect(matchTemplate("http://h/api/incidents/:id", "http://h/api/users/7")).toBeNull();
  });

  it("refuses a url of a different length", () => {
    expect(matchTemplate("http://h/api/incidents/:id", "http://h/api/incidents/7/notes")).toBeNull();
  });

  it("does not treat two identical urls as a template being filled in", () => {
    // otherwise every tab would claim every response
    expect(matchTemplate("http://h/api/incidents", "http://h/api/incidents")).toBeNull();
  });

  it("decodes a value that had to be escaped", () => {
    expect(matchTemplate("http://h/api/users/:email", "http://h/api/users/a%40b.com")).toEqual({
      email: "a@b.com",
    });
  });
});

describe("a {{variable}} used as a placeholder's value", () => {
  it("is resolved, not encoded and sent", () => {
    expect(
      applyPathParams("/api/users/:id", { id: "{{id}}" }, { id: "6a860eee" })
    ).toBe("/api/users/6a860eee");
  });

  // %7B%7Bid%7D%7D reaching the server produced an error about a malformed id
  // that named nothing anyone had typed
  it("leaves the placeholder alone when the name has no value behind it", () => {
    expect(applyPathParams("/api/users/:id", { id: "{{id}}" }, {})).toBe("/api/users/:id");
  });

  it("still encodes a plain value that needs it", () => {
    expect(applyPathParams("/api/users/:id", { id: "a b/c" }, {})).toBe("/api/users/a%20b%2Fc");
  });

  it("resolves a name embedded in a longer value", () => {
    expect(
      applyPathParams("/api/users/:id", { id: "user-{{id}}" }, { id: "7" })
    ).toBe("/api/users/user-7");
  });
});
