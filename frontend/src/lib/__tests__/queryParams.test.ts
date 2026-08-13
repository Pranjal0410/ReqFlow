import { paramsFromUrl, urlWithParams } from "../queryParams";

describe("paramsFromUrl", () => {
  it("reads pairs out of the query string", () => {
    expect(paramsFromUrl("http://x/y?status=open&page=2")).toEqual([
      { key: "status", value: "open", enabled: true },
      { key: "page", value: "2", enabled: true },
    ]);
  });

  it("returns nothing when there is no query", () => {
    expect(paramsFromUrl("http://x/y")).toEqual([]);
  });

  it("decodes values and handles a key with no value", () => {
    expect(paramsFromUrl("http://x/y?q=a%20b&flag")).toEqual([
      { key: "q", value: "a b", enabled: true },
      { key: "flag", value: "", enabled: true },
    ]);
  });

  it("keeps a row whose encoding is broken rather than dropping it", () => {
    expect(paramsFromUrl("http://x/y?q=%E0%A4")[0].value).toBe("%E0%A4");
  });
});

describe("urlWithParams", () => {
  it("rewrites the query and leaves the path alone", () => {
    expect(urlWithParams("http://x/y?a=1", [{ key: "b", value: "2", enabled: true }])).toBe(
      "http://x/y?b=2"
    );
  });

  it("drops disabled and unnamed rows", () => {
    const out = urlWithParams("http://x/y", [
      { key: "a", value: "1", enabled: false },
      { key: "", value: "2", enabled: true },
      { key: "c", value: "3", enabled: true },
    ]);
    expect(out).toBe("http://x/y?c=3");
  });

  it("removes the question mark when nothing is left", () => {
    expect(urlWithParams("http://x/y?a=1", [])).toBe("http://x/y");
  });

  it("does not encode a {{variable}} into uselessness", () => {
    // %7B%7Btoken%7D%7D would never be resolved by the substitution step
    expect(urlWithParams("http://x/y", [{ key: "t", value: "{{token}}", enabled: true }])).toBe(
      "http://x/y?t={{token}}"
    );
  });

  it("still encodes ordinary characters", () => {
    expect(urlWithParams("http://x/y", [{ key: "q", value: "a b&c", enabled: true }])).toBe(
      "http://x/y?q=a%20b%26c"
    );
  });

  it("preserves a fragment", () => {
    expect(urlWithParams("http://x/y?a=1#top", [{ key: "b", value: "2", enabled: true }])).toBe(
      "http://x/y?b=2#top"
    );
  });
});
