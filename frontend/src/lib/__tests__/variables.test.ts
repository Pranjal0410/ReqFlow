import { isSecretVariable, missingIn, substitute, toMap } from "../variables";

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
