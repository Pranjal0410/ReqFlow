import { findToken, isSecretVariable, missingIn, substitute, toMap, workspaceAuth, holdsACredential, unfilledHeaders } from "../variables";

const vars = toMap([
  { key: "token", value: "abc123" },
  { key: "host", value: "localhost:3001" },
  { key: "  ", value: "ignored" },
]);

describe("substitute", () => {
  it("replaces a placeholder anywhere in the text", () => {
    expect(substitute("http://{{host}}/api", vars)).toBe("http://localhost:3001/api");
    expect(substitute("Bearer {{token}}", vars)).toBe("Bearer abc123");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(substitute("Bearer {{ token }}", vars)).toBe("Bearer abc123");
  });

  it("leaves an unknown name alone so a typo is visible", () => {
    expect(substitute("Bearer {{toekn}}", vars)).toBe("Bearer {{toekn}}");
  });

  it("replaces every occurrence", () => {
    expect(substitute("{{token}}/{{token}}", vars)).toBe("abc123/abc123");
  });
});

describe("toMap", () => {
  it("drops rows with a blank name", () => {
    expect(Object.keys(toMap([{ key: " ", value: "x" }]))).toEqual([]);
  });
});

describe("missingIn", () => {
  it("lists names with nothing behind them, once each", () => {
    expect(missingIn("{{a}} {{token}} {{a}}", vars)).toEqual(["a"]);
  });
});

describe("isSecretVariable", () => {
  it("treats credential-shaped names as secret", () => {
    ["token", "authToken", "api_key", "PASSWORD", "auth"].forEach((n) =>
      expect(isSecretVariable(n)).toBe(true)
    );
  });

  it("leaves ordinary names alone", () => {
    ["host", "page", "userId"].forEach((n) => expect(isSecretVariable(n)).toBe(false));
  });
});

// a login answers with the value every other request needs, and moving it by
// hand meant reading it out of the body and pasting it into each tab
describe("findToken", () => {
  it("finds a top level token", () => {
    expect(findToken({ token: "abcdefghijk" })).toEqual({ path: "token", value: "abcdefghijk" });
  });

  it("looks one level in", () => {
    expect(findToken({ data: { accessToken: "abcdefghijk" } })).toEqual({
      path: "data.accessToken",
      value: "abcdefghijk",
    });
  });

  it("knows the usual spellings", () => {
    ["access_token", "idToken", "jwt", "authToken"].forEach((k) =>
      expect(findToken({ [k]: "abcdefghijk" })?.value).toBe("abcdefghijk")
    );
  });

  it("ignores a field that merely mentions a token", () => {
    expect(findToken({ tokenExpiry: "3600", message: "token issued" })).toBeNull();
  });

  it("ignores something too short to be one", () => {
    expect(findToken({ token: "no" })).toBeNull();
  });

  it("returns nothing for a body with no credential in it", () => {
    expect(findToken({ user: { email: "a@b.c" } })).toBeNull();
    expect(findToken(null)).toBeNull();
    expect(findToken("a string")).toBeNull();
  });
});

// a secret's value lives in sessionStorage, so reopening the browser leaves the
// row behind without it. treating that as "" sent "Bearer " and said nothing.
describe("a name with no value", () => {
  it("counts as unset rather than as an empty string", () => {
    expect(toMap([{ key: "token", value: "" }])).toEqual({});
  });

  it("leaves the placeholder visible instead of blanking the header", () => {
    const vars = toMap([{ key: "token", value: "" }]);
    expect(substitute("Bearer {{token}}", vars)).toBe("Bearer {{token}}");
  });

  it("is reported as missing", () => {
    const vars = toMap([{ key: "token", value: "" }]);
    expect(missingIn("Bearer {{token}}", vars)).toEqual(["token"]);
  });

  it("still resolves once it has one", () => {
    const vars = toMap([{ key: "token", value: "abc" }]);
    expect(substitute("Bearer {{token}}", vars)).toBe("Bearer abc");
    expect(missingIn("Bearer {{token}}", vars)).toEqual([]);
  });
});

// Finding a record for an :id means listing the collection, and on a real API
// that list is behind a login. The generated request does not always carry one,
// so the credential the developer is already using in this workspace is offered
// — after the server has said 401, and never invented.
describe("workspaceAuth", () => {
  const vars = { token: "eyJhbGciOi.real.token" };

  it("finds the token the developer is already sending", () => {
    const tabs = [
      { headers: [{ key: "content-type", value: "application/json", enabled: true }] },
      { headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }] },
    ];
    expect(workspaceAuth(tabs, vars)).toBe("Bearer eyJhbGciOi.real.token");
  });

  it("ignores a header the developer switched off", () => {
    const tabs = [{ headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: false }] }];
    expect(workspaceAuth(tabs, vars)).toBeNull();
  });

  it("will not pass on an unresolved placeholder", () => {
    // "Bearer {{token}}" with no such variable is not a credential
    const tabs = [{ headers: [{ key: "Authorization", value: "Bearer {{missing}}", enabled: true }] }];
    expect(workspaceAuth(tabs, vars)).toBeNull();
  });

  it("has nothing to offer when no tab authenticates", () => {
    expect(workspaceAuth([{ headers: [] }], vars)).toBeNull();
    expect(workspaceAuth([], vars)).toBeNull();
  });
});

// The Auth field takes whatever was on the clipboard, and that is often the
// whole header rather than the token in it. These are the shapes it has to
// survive, checked here because the field's own handler is in a component the
// test runner will not load.
describe("what counts as the token when a header was pasted", () => {
  const asToken = (pasted: string) =>
    pasted
      .trim()
      .replace(/^Bearer\s+/i, "")
      .replace(/\{\{\s*token\s*\}\}/gi, "")
      .trim();

  it("takes the token out of a pasted header", () => {
    expect(asToken("Bearer eyJhbGciOi")).toBe("eyJhbGciOi");
    expect(asToken("bearer eyJhbGciOi")).toBe("eyJhbGciOi");
  });

  // this one sent "Bearer Bearer {{token}}" and the server called it invalid
  it("refuses to store a reference as the thing it refers to", () => {
    expect(asToken("Bearer {{token}}")).toBe("");
    expect(asToken("{{token}}")).toBe("");
  });

  it("leaves a plain token alone", () => {
    expect(asToken("  eyJhbGciOi  ")).toBe("eyJhbGciOi");
  });
});


// This decided what gets written to disk, and it lived in a module the runner
// will not load — so nothing checked it until a restart started emptying the
// Authorization header of every tab.
describe("telling a credential from a reference to one", () => {
  it("calls a real token a credential", () => {
    expect(holdsACredential("Authorization", "Bearer eyJhbGciOi")).toBe(true);
    expect(holdsACredential("Cookie", "session=abc")).toBe(true);
    expect(holdsACredential("X-Api-Key", "live-abc")).toBe(true);
  });

  // the one that went wrong: stripped on every save, so the header came back
  // empty and the request went out with no authentication at all
  it("does not call a reference one", () => {
    expect(holdsACredential("Authorization", "Bearer {{token}}")).toBe(false);
    expect(holdsACredential("X-Api-Key", "{{apiKey}}")).toBe(false);
  });

  it("has nothing to protect in an ordinary header or an empty one", () => {
    expect(holdsACredential("Content-Type", "application/json")).toBe(false);
    expect(holdsACredential("Authorization", "")).toBe(false);
    expect(holdsACredential("", "anything")).toBe(false);
  });
});


describe("headers that were named and never filled in", () => {
  const h = (key: string, value: string, enabled = true) => ({ key, value, enabled });

  // the one that cost an afternoon: the row looked exactly as it always had
  it("names an enabled header with nothing in it", () => {
    expect(unfilledHeaders([h("Authorization", "")])).toEqual(["Authorization"]);
    expect(unfilledHeaders([h("Authorization", "   ")])).toEqual(["Authorization"]);
  });

  it("says nothing about one that is filled in", () => {
    expect(unfilledHeaders([h("Authorization", "Bearer {{token}}")])).toEqual([]);
    expect(unfilledHeaders([h("Content-Type", "application/json")])).toEqual([]);
  });

  // switching a row off is how you say you did not mean to send it
  it("leaves a row that was switched off alone", () => {
    expect(unfilledHeaders([h("Authorization", "", false)])).toEqual([]);
  });

  it("ignores a row with no name, which is just an empty row", () => {
    expect(unfilledHeaders([h("", "")])).toEqual([]);
    expect(unfilledHeaders([h("  ", "value")])).toEqual([]);
  });

  it("names each one once, however many rows repeat it", () => {
    expect(unfilledHeaders([h("X-Trace", ""), h("X-Trace", "")])).toEqual(["X-Trace"]);
  });

  it("has nothing to say about no headers at all", () => {
    expect(unfilledHeaders([])).toEqual([]);
  });
});
