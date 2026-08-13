import { ApiResponse } from "../../types";
import { compare, endpointKey, record, summarise, TimingHistory } from "../timings";

function response(total: number, ttfb = total, spans: Record<string, number> = {}): ApiResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    data: {},
    timing: { total, ttfb, download: total - ttfb },
    size: 0,
    sizeSource: "measured",
    serverTiming: Object.entries(spans).map(([name, duration]) => ({
      name,
      description: null,
      duration,
    })),
  };
}

function withRuns(url: string, totals: number[], spans: Record<string, number>[] = []): TimingHistory {
  let history: TimingHistory = {};
  totals.forEach((t, i) => {
    history = record(history, "GET", url, response(t, t, spans[i] || {}));
  });
  return history;
}

const URL = "http://localhost:3001/api/incidents";

describe("endpointKey", () => {
  it("ignores the query string so one endpoint keeps one baseline", () => {
    expect(endpointKey("get", `${URL}?status=open`)).toBe(endpointKey("GET", `${URL}?status=closed`));
  });

  it("keeps different methods on the same path apart", () => {
    expect(endpointKey("GET", URL)).not.toBe(endpointKey("POST", URL));
  });

  it("gives a schemeless url the same key as the full one", () => {
    // otherwise typing the address either way splits one endpoint's history
    // into two baselines that never compare against each other
    expect(endpointKey("GET", "localhost:3001/x?a=1")).toBe("GET /x");
    expect(endpointKey("GET", "http://localhost:3001/x")).toBe("GET /x");
  });
});

describe("record", () => {
  it("does not let a failed request into the baseline", () => {
    const failed = { ...response(5000), status: 0 };
    expect(record({}, "GET", URL, failed)).toEqual({});
  });

  it("keeps only the most recent samples", () => {
    const history = withRuns(URL, Array.from({ length: 25 }, (_, i) => i + 1));
    const samples = history[endpointKey("GET", URL)];
    expect(samples).toHaveLength(20);
    expect(samples[samples.length - 1].total).toBe(25);
  });
});

describe("summarise", () => {
  it("says nothing until there are enough runs to have a baseline", () => {
    expect(summarise(withRuns(URL, [100, 100]), "GET", URL, response(900))).toBeNull();
  });

  it("calls out a run that is both proportionally and absolutely slower", () => {
    const out = summarise(withRuns(URL, [100, 100, 100]), "GET", URL, response(400))!;
    expect(out.slower).toBe(true);
    expect(out.text).toMatch(/4\.0× slower/);
    expect(out.text).toMatch(/100 ms over 3 runs/);
  });

  it("ignores a big ratio on tiny numbers", () => {
    // 2 ms to 6 ms is 3x but means nothing
    const out = summarise(withRuns(URL, [2, 2, 2]), "GET", URL, response(6))!;
    expect(out.slower).toBe(false);
  });

  it("uses the median so one cold start cannot set the normal time", () => {
    const out = summarise(withRuns(URL, [100, 100, 100, 100, 2000]), "GET", URL, response(120))!;
    expect(out.text).toMatch(/100 ms/);
    expect(out.slower).toBe(false);
  });

  it("reports a run that got faster", () => {
    const out = summarise(withRuns(URL, [400, 400, 400]), "GET", URL, response(50))!;
    expect(out.slower).toBe(false);
    expect(out.text).toMatch(/faster than usual/);
  });
});

describe("compare", () => {
  it("breaks a regression down by phase", () => {
    const history = withRuns(URL, [100, 100, 100]);
    const phases = compare(history, "GET", URL, response(500, 480));

    const ttfb = phases.find((p) => p.name === "ttfb")!;
    expect(ttfb.slower).toBe(true);
    expect(ttfb.baseline).toBe(100);
    expect(ttfb.runs).toBe(3);

    // the body was not what got slower, and the ui should not imply it was
    expect(phases.find((p) => p.name === "download")!.slower).toBe(false);
  });

  it("compares a server reported span against its own history", () => {
    const spans = [{ db: 8 }, { db: 8 }, { db: 10 }];
    const history = withRuns(URL, [20, 20, 20], spans);

    const db = compare(history, "GET", URL, response(220, 220, { db: 200 })).find(
      (p) => p.name === "db"
    )!;

    expect(db.slower).toBe(true);
    expect(db.baseline).toBe(8);
  });

  it("skips a span the server has not reported before", () => {
    const history = withRuns(URL, [20, 20, 20]);
    const phases = compare(history, "GET", URL, response(220, 220, { cache: 200 }));
    expect(phases.find((p) => p.name === "cache")).toBeUndefined();
  });

  it("returns nothing for an endpoint with no history", () => {
    expect(compare({}, "GET", URL, response(500))).toEqual([]);
  });
});

// a 401 rejected at the door and a 200 that returns a payload are different
// operations. mixing them reported a regression the moment you logged in.
describe("status classes", () => {
  function withStatuses(pairs: [number, number][]): TimingHistory {
    let h: TimingHistory = {};
    pairs.forEach(([status, total]) => {
      h = record(h, "GET", URL, { ...response(total), status });
    });
    return h;
  }

  it("does not measure a success against a run of rejections", () => {
    const history = withStatuses([[401, 7], [401, 5], [401, 6]]);
    expect(summarise(history, "GET", URL, { ...response(400), status: 200 })).toBeNull();
  });

  it("uses only the successful runs once there are enough of them", () => {
    const history = withStatuses([
      [401, 7], [401, 5],
      [200, 400], [200, 420], [200, 410],
    ]);

    const out = summarise(history, "GET", URL, { ...response(430), status: 200 })!;
    expect(out.slower).toBe(false);
    expect(out.text).toMatch(/410 ms over 3 runs/);
  });

  it("keeps 200 and 201 in the same bucket", () => {
    const history = withStatuses([[200, 100], [201, 100], [200, 100]]);
    expect(summarise(history, "GET", URL, { ...response(110), status: 201 })).not.toBeNull();
  });

  it("compares phases within the same class too", () => {
    const history = withStatuses([[401, 5], [401, 5], [401, 5]]);
    expect(compare(history, "GET", URL, { ...response(500), status: 200 })).toEqual([]);
  });
});
