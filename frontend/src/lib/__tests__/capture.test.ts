import {
  valueAt,
  runCaptures,
  withResults,
  suggestions,
  isUsableName,
  Capture,
} from "../capture";

const res = (status: number, data: any): any => ({
  status,
  data,
  headers: {},
  timing: { total: 1 },
  size: 0,
  sizeSource: "measured",
});

const rule = (from: string, name: string): Capture => ({
  id: from + name,
  from,
  name,
  lastValue: null,
});

describe("finding the value in a body", () => {
  it("reads a field at the top", () => {
    expect(valueAt({ id: "abc" }, "id")).toBe("abc");
  });

  it("reads one nested inside", () => {
    expect(valueAt({ incident: { id: 7 } }, "incident.id")).toBe("7");
  });

  it("indexes into a list", () => {
    expect(valueAt({ items: [{ id: "first" }, { id: "second" }] }, "items.1.id")).toBe("second");
  });

  it("indexes into a body that is itself a list", () => {
    expect(valueAt([{ id: "only" }], "0.id")).toBe("only");
  });

  // half of these APIs wrap the payload and half do not, and which one you are
  // talking to is not worth being strict about
  it("finds a field written with a data wrapper the body does not have", () => {
    expect(valueAt({ id: "abc" }, "data.id")).toBe("abc");
  });

  it("finds a field written without the wrapper the body does have", () => {
    expect(valueAt({ data: { id: "abc" } }, "id")).toBe("abc");
  });

  it("turns numbers and booleans into text, because that is what a variable is", () => {
    expect(valueAt({ n: 42 }, "n")).toBe("42");
    expect(valueAt({ ok: false }, "ok")).toBe("false");
  });

  // "[object Object]" in a URL is not a value
  it("refuses an object or an array", () => {
    expect(valueAt({ user: { id: 1 } }, "user")).toBeNull();
    expect(valueAt({ ids: [1, 2] }, "ids")).toBeNull();
  });

  it("has nothing to say about a path that is not there", () => {
    expect(valueAt({ id: "abc" }, "missing.deeply")).toBeNull();
    expect(valueAt(null, "id")).toBeNull();
    expect(valueAt({ id: "abc" }, "")).toBeNull();
  });
});

describe("running the rules on a response", () => {
  it("takes what each rule asks for", () => {
    const found = runCaptures([rule("data.id", "incidentId"), rule("token", "token")], res(201, {
      data: { id: "inc-1" },
      token: "jwt-value",
    }));
    expect(found).toEqual([
      { name: "incidentId", value: "inc-1" },
      { name: "token", value: "jwt-value" },
    ]);
  });

  // a 401 body that mentions a token must not overwrite the one that works,
  // or one failed request turns into a run of them
  it("takes nothing from a response the server refused", () => {
    expect(runCaptures([rule("token", "token")], res(401, { token: "expired" }))).toEqual([]);
    expect(runCaptures([rule("id", "id")], res(500, { id: "x" }))).toEqual([]);
  });

  it("skips a rule with no name, and one whose field is missing", () => {
    const found = runCaptures([rule("id", "  "), rule("nope", "x")], res(200, { id: "abc" }));
    expect(found).toEqual([]);
  });

  it("lets the last rule for a name win", () => {
    const found = runCaptures([rule("a", "v"), rule("b", "v")], res(200, { a: "1", b: "2" }));
    expect(found).toEqual([{ name: "v", value: "2" }]);
  });

  it("has nothing to run against no response", () => {
    expect(runCaptures([rule("id", "id")], null)).toEqual([]);
  });
});

describe("showing what a rule picked up", () => {
  it("writes the value back beside the rule that found it", () => {
    const [first] = withResults([rule("id", "incidentId")], [{ name: "incidentId", value: "inc-9" }]);
    expect(first.lastValue).toBe("inc-9");
  });

  // the value is still the one in use, so clearing it would say the rule had
  // stopped working when it had only not fired this time
  it("leaves an earlier value alone when the rule found nothing", () => {
    const held: Capture = { ...rule("id", "incidentId"), lastValue: "inc-8" };
    expect(withResults([held], [])[0].lastValue).toBe("inc-8");
  });
});

describe("offering paths from a body already on screen", () => {
  it("offers the identifiers, not the prose", () => {
    const found = suggestions({ id: "inc-1", title: "Database is down", severity: "high" });
    expect(found).toEqual([{ path: "id", value: "inc-1" }]);
  });

  it("looks inside a wrapper", () => {
    expect(suggestions({ data: { _id: "abc" } })).toContainEqual({ path: "data._id", value: "abc" });
  });

  it("takes the first element of a list to stand for the list", () => {
    const found = suggestions([{ id: "a" }, { id: "b" }]);
    expect(found).toEqual([{ path: "0.id", value: "a" }]);
  });

  it("offers the shallow paths before the deep ones", () => {
    const found = suggestions({ id: "top", nested: { id: "deep" } });
    expect(found[0]).toEqual({ path: "id", value: "top" });
  });

  it("has nothing to offer for a body with no identifiers in it", () => {
    expect(suggestions({ message: "ok" })).toEqual([]);
    expect(suggestions(null)).toEqual([]);
  });
});

describe("names that can actually be used", () => {
  it("accepts what {{ }} can hold", () => {
    expect(isUsableName("incidentId")).toBe(true);
    expect(isUsableName("auth.token")).toBe(true);
  });

  // these resolve as nothing, which reads as the capture having failed
  it("refuses what it cannot", () => {
    expect(isUsableName("incident id")).toBe(false);
    expect(isUsableName("")).toBe(false);
    expect(isUsableName("{{id}}")).toBe(false);
  });
});
