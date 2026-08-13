import { originOf, withScheme } from "../url";

// "localhost:3001" is what a developer types, and new URL() accepts it by
// reading localhost: as the scheme. that made the target guard call localhost a
// public address, and made the header render the literal string "null".
describe("withScheme", () => {
  it("adds http to a bare host and port", () => {
    expect(withScheme("localhost:3001")).toBe("http://localhost:3001");
    expect(withScheme("127.0.0.1:8080/api")).toBe("http://127.0.0.1:8080/api");
  });

  it("leaves a url that already has one alone", () => {
    expect(withScheme("https://example.com")).toBe("https://example.com");
    expect(withScheme("http://localhost:3001")).toBe("http://localhost:3001");
  });

  it("trims and keeps an empty value empty", () => {
    expect(withScheme("  http://x  ")).toBe("http://x");
    expect(withScheme("   ")).toBe("");
  });
});

describe("originOf", () => {
  it("resolves a schemeless host rather than returning URL's \"null\" origin", () => {
    expect(originOf("localhost:3001")).toBe("http://localhost:3001");
  });

  it("reads the origin of a full url", () => {
    expect(originOf("http://localhost:3001/api/incidents?x=1")).toBe("http://localhost:3001");
  });

  it("returns null for something that is not http", () => {
    expect(originOf("ftp://localhost:21")).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf("   ")).toBeNull();
  });
});
