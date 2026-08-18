import { onlyRealCode, onlyRealRoutes, onlyRealRuns } from "../restore";

// The agent's code now outlives the session, so a saved blob is something the
// app will trust tomorrow. A half-written entry restored as if it were whole
// opens a code view with nothing in it — which reads as the app having lost the
// code, rather than as one record being unusable.
describe("restoring generated code", () => {
  const whole = {
    method: "GET",
    path: "/api/incidents/:id/duration",
    summary: "how long it has been open",
    layers: [{ layer: "router", path: "src/routes/incidents.js", code: "router.get(...)" }],
    request: { headers: {}, body: null },
    notes: [],
    references: [],
    verify: null,
  };

  it("keeps an endpoint that is actually complete", () => {
    expect(Object.keys(onlyRealCode({ "GET /x": whole }))).toEqual(["GET /x"]);
  });

  it("drops an entry with no layers, which would open an empty panel", () => {
    expect(onlyRealCode({ "GET /x": { ...whole, layers: [] } })).toEqual({});
    expect(onlyRealCode({ "GET /x": { ...whole, layers: undefined } })).toEqual({});
  });

  it("drops an entry that does not even name an endpoint", () => {
    expect(onlyRealCode({ "GET /x": { ...whole, method: undefined } })).toEqual({});
    expect(onlyRealCode({ "GET /x": { ...whole, path: 42 } })).toEqual({});
  });

  it("keeps the good entries when only some are broken", () => {
    const mixed = { "GET /x": whole, "POST /y": { layers: [] } };
    expect(Object.keys(onlyRealCode(mixed))).toEqual(["GET /x"]);
  });

  it("treats a workspace saved before any of this as having none", () => {
    // the field simply will not be there, which is the same state as a session
    // that generated nothing
    expect(onlyRealCode(undefined)).toEqual({});
    expect(onlyRealCode(null)).toEqual({});
    expect(onlyRealCode("not an object")).toEqual({});
    expect(onlyRealCode([])).toEqual({});
  });
});

describe("restoring drafted endpoints", () => {
  it("keeps a route that names a method and a path", () => {
    const routes = [{ method: "GET", path: "/api/x", url: "http://h/api/x", label: "x", tabId: "1" }];
    expect(onlyRealRoutes(routes)).toHaveLength(1);
  });

  it("drops anything that could not be listed", () => {
    expect(onlyRealRoutes([{ method: "GET" }, null, "nope", { path: "/x" }])).toEqual([]);
  });

  it("treats a missing field as none", () => {
    expect(onlyRealRoutes(undefined)).toEqual([]);
  });
});

describe("restoring applied runs", () => {
  const run = {
    id: "1",
    at: 1,
    method: "POST",
    path: "/api/x",
    verdict: "verified",
    text: "ok",
    phases: [{ phase: "reload", ms: 100 }],
  };

  it("keeps a run that has its breakdown", () => {
    expect(onlyRealRuns([run])).toHaveLength(1);
  });

  it("drops a run with no phases, whose panel would be empty", () => {
    // the breakdown is most of why the record is worth keeping
    expect(onlyRealRuns([{ ...run, phases: undefined }])).toEqual([]);
  });

  it("treats a missing field as none", () => {
    expect(onlyRealRuns(null)).toEqual([]);
  });
});
