import { parseServerTiming } from "../services/serverTiming";

describe("parseServerTiming", () => {
  it("returns nothing when the server sent no header", () => {
    expect(parseServerTiming(undefined)).toEqual([]);
    expect(parseServerTiming("")).toEqual([]);
  });

  it("reads name, duration and description", () => {
    expect(parseServerTiming('db;dur=18;desc="INSERT INTO users"')).toEqual([
      { name: "db", description: "INSERT INTO users", duration: 18 },
    ]);
  });

  it("reads several metrics from one header", () => {
    const spans = parseServerTiming("controller;dur=15, service;dur=32, db;dur=18");
    expect(spans.map((s) => s.name)).toEqual(["controller", "service", "db"]);
    expect(spans.map((s) => s.duration)).toEqual([15, 32, 18]);
  });

  it("accepts params in either order", () => {
    expect(parseServerTiming('cache;desc="Cache Read";dur=23.2')).toEqual([
      { name: "cache", description: "Cache Read", duration: 23.2 },
    ]);
  });

  it("keeps a description that contains a comma or a semicolon", () => {
    // splitting on the raw characters would cut this query in half and invent
    // a second span out of the remainder
    const spans = parseServerTiming('db;desc="SELECT a, b FROM t; LIMIT 1";dur=4');
    expect(spans).toHaveLength(1);
    expect(spans[0].description).toBe("SELECT a, b FROM t; LIMIT 1");
    expect(spans[0].duration).toBe(4);
  });

  it("unescapes a quote inside a description", () => {
    const spans = parseServerTiming('db;desc="the \\"users\\" table"');
    expect(spans[0].description).toBe('the "users" table');
  });

  it("keeps a metric that has a name but no duration", () => {
    expect(parseServerTiming("missedCache")).toEqual([
      { name: "missedCache", description: null, duration: null },
    ]);
  });

  it("treats an unusable duration as no duration rather than showing a number", () => {
    expect(parseServerTiming("db;dur=abc")[0].duration).toBeNull();
    expect(parseServerTiming("db;dur=-5")[0].duration).toBeNull();
    expect(parseServerTiming("db;dur=")[0].duration).toBeNull();
  });

  it("joins a header that arrived more than once", () => {
    const spans = parseServerTiming(["app;dur=10", "db;dur=20"]);
    expect(spans.map((s) => s.name)).toEqual(["app", "db"]);
  });

  it("ignores whitespace and empty entries", () => {
    const spans = parseServerTiming("  app;dur=10 , , db;dur=20  ");
    expect(spans.map((s) => s.name)).toEqual(["app", "db"]);
  });

  it("ignores params it does not know", () => {
    const spans = parseServerTiming("db;dur=9;foo=bar");
    expect(spans).toEqual([{ name: "db", description: null, duration: 9 }]);
  });
});
