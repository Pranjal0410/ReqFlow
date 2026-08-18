import {
  exampleKey,
  isSecretName,
  redactBody,
  toExample,
  record,
  forEndpoint,
  describeAge,
  coerceLimit,
  REDACTED,
  Example,
  ExampleStore,
} from "../examples";
import { ApiResponse } from "../../types";

const response = (status: number): ApiResponse =>
  ({
    status,
    statusText: "OK",
    headers: {},
    data: { ok: true },
    timing: { total: 10, ttfb: 5, download: 5 },
    size: 12,
    sizeSource: "measured",
    serverTiming: [],
  } as unknown as ApiResponse);

describe("exampleKey", () => {
  it("ignores the query string, which is not part of the endpoint", () => {
    expect(exampleKey("GET", "http://x/api/users?page=2")).toBe(
      exampleKey("GET", "http://x/api/users")
    );
  });

  it("keeps method and path apart", () => {
    expect(exampleKey("POST", "http://x/api/users")).not.toBe(
      exampleKey("GET", "http://x/api/users")
    );
  });

  it("does not care about a trailing slash", () => {
    expect(exampleKey("GET", "http://x/api/users/")).toBe(exampleKey("GET", "http://x/api/users"));
  });
});

// a saved example is a file on disk, so a credential in one is a credential on
// disk. this is the whole reason responses were not persisted before.
describe("redaction", () => {
  it("recognises the names that carry credentials", () => {
    expect(isSecretName("Authorization")).toBe(true);
    expect(isSecretName("Cookie")).toBe(true);
    expect(isSecretName("x-api-key")).toBe(true);
    expect(isSecretName("password")).toBe(true);
    expect(isSecretName("Content-Type")).toBe(false);
    expect(isSecretName("email")).toBe(false);
  });

  it("removes the header value but keeps the header", () => {
    const ex = toExample(
      { method: "GET", url: "http://x/api/me", body: "" },
      { Authorization: "Bearer real-token", "Content-Type": "application/json" },
      response(200),
      1000
    );
    // the request still reads as an authorised one, which is the part worth keeping
    expect(ex.headers.Authorization).toBe(REDACTED);
    expect(ex.headers["Content-Type"]).toBe("application/json");
  });

  // the login body carries the very thing the header redaction is protecting
  it("removes a password out of a json body, keeping the shape", () => {
    const out = JSON.parse(redactBody('{"email":"a@b.com","password":"hunter2"}'));
    expect(out.email).toBe("a@b.com");
    expect(out.password).toBe(REDACTED);
  });

  it("reaches nested and repeated fields", () => {
    const out = JSON.parse(
      redactBody('{"user":{"apiKey":"k"},"list":[{"token":"t"},{"name":"n"}]}')
    );
    expect(out.user.apiKey).toBe(REDACTED);
    expect(out.list[0].token).toBe(REDACTED);
    expect(out.list[1].name).toBe("n");
  });

  // a body we cannot parse has no field names to judge, so it is dropped whole
  // rather than saved on the hope that it holds nothing
  it("drops an unparseable body that mentions a secret", () => {
    expect(redactBody("password=hunter2&user=a")).toBe(REDACTED);
    expect(redactBody("plain text note")).toBe("plain text note");
  });

  it("leaves an empty body alone", () => {
    expect(redactBody("")).toBe("");
  });
});

describe("record", () => {
  const make = (at: number, url = "http://x/api/users"): Example =>
    toExample({ method: "POST", url, body: "" }, {}, response(201), at);

  it("keeps the newest first", () => {
    let store: ExampleStore = {};
    store = record(store, make(1), 3);
    store = record(store, make(2), 3);
    expect(forEndpoint(store, "POST", "http://x/api/users").map((e) => e.at)).toEqual([2, 1]);
  });

  it("keeps only as many as the limit allows", () => {
    let store: ExampleStore = {};
    for (let i = 1; i <= 6; i++) store = record(store, make(i), 3);

    const kept = forEndpoint(store, "POST", "http://x/api/users");
    expect(kept).toHaveLength(3);
    expect(kept.map((e) => e.at)).toEqual([6, 5, 4]);
  });

  it("honours a limit of five", () => {
    let store: ExampleStore = {};
    for (let i = 1; i <= 8; i++) store = record(store, make(i), 5);
    expect(forEndpoint(store, "POST", "http://x/api/users")).toHaveLength(5);
  });

  it("holds endpoints apart", () => {
    let store: ExampleStore = {};
    store = record(store, make(1, "http://x/api/users"), 3);
    store = record(store, make(2, "http://x/api/orders"), 3);

    expect(forEndpoint(store, "POST", "http://x/api/users")).toHaveLength(1);
    expect(forEndpoint(store, "POST", "http://x/api/orders")).toHaveLength(1);
  });

  it("returns nothing for an endpoint never sent", () => {
    expect(forEndpoint({}, "GET", "http://x/api/nothing")).toEqual([]);
  });
});

describe("coerceLimit", () => {
  it("allows only the two settings that exist", () => {
    expect(coerceLimit(5)).toBe(5);
    expect(coerceLimit(3)).toBe(3);
    expect(coerceLimit(50)).toBe(3);
    expect(coerceLimit("5")).toBe(3);
    expect(coerceLimit(undefined)).toBe(3);
  });
});

describe("describeAge", () => {
  it("answers the only question being asked of an example", () => {
    const now = 1_000_000_000;
    expect(describeAge(now - 5_000, now)).toBe("5s ago");
    expect(describeAge(now - 120_000, now)).toBe("2m ago");
    expect(describeAge(now - 7_200_000, now)).toBe("2h ago");
    expect(describeAge(now - 172_800_000, now)).toBe("2d ago");
  });

  it("does not go negative on a clock that moved", () => {
    expect(describeAge(2000, 1000)).toBe("0s ago");
  });
});
