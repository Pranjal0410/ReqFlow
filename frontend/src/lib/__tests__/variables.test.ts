import { findToken, isSecretVariable, missingIn, substitute, toMap } from "../variables";

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
