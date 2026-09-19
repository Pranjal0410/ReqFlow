import {
  buildPostmanCollection,
  buildPostmanEnvironment,
  buildPostmanUrl,
  parsePostmanCollection,
  parsePostmanEnvironment,
} from "../services/postman";

describe("buildPostmanCollection", () => {
  it("names the collection and points at the v2.1 schema", () => {
    const out = buildPostmanCollection({ name: "demo", requests: [], environments: [] }) as any;
    expect(out.info).toEqual({
      name: "demo",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    });
  });

  it("keeps one item per request, method and name included", () => {
    const out = buildPostmanCollection({
      name: "demo",
      environments: [],
      requests: [
        { name: "get users", method: "GET", url: "{{BASE_URL}}/users", headers: [], body: "" },
        { name: "create user", method: "POST", url: "{{BASE_URL}}/users", headers: [], body: "{}" },
      ],
    }) as any;
    expect(out.item).toHaveLength(2);
    expect(out.item[0]).toMatchObject({ name: "get users", request: { method: "GET" } });
    expect(out.item[1]).toMatchObject({ name: "create user", request: { method: "POST" } });
  });

  // enabled/disabled is Postman's own header flag, inverted from ReqFlow's
  it("carries headers over, flipping enabled to Postman's disabled", () => {
    const out = buildPostmanCollection({
      name: "demo",
      environments: [],
      requests: [
        {
          name: "x",
          method: "GET",
          url: "{{BASE_URL}}/x",
          headers: [
            { key: "Authorization", value: "Bearer {{token}}", enabled: true },
            { key: "X-Debug", value: "1", enabled: false },
          ],
          body: "",
        },
      ],
    }) as any;
    expect(out.item[0].request.header).toEqual([
      { key: "Authorization", value: "Bearer {{token}}", disabled: false },
      { key: "X-Debug", value: "1", disabled: true },
    ]);
  });

  it("sends a non-empty body as raw json, and no body field at all when there is none", () => {
    const out = buildPostmanCollection({
      name: "demo",
      environments: [],
      requests: [
        { name: "create", method: "POST", url: "{{BASE_URL}}/x", headers: [], body: '{"a":1}' },
        { name: "get", method: "GET", url: "{{BASE_URL}}/x", headers: [], body: "" },
      ],
    }) as any;
    expect(out.item[0].request.body).toEqual({
      mode: "raw",
      raw: '{"a":1}',
      options: { raw: { language: "json" } },
    });
    expect(out.item[1].request.body).toBeUndefined();
  });
});

describe("buildPostmanUrl", () => {
  // the common case now that new tabs use {{BASE_URL}}/path — Postman's own
  // idiom for an environment-variable base url is the same shape
  it("puts {{BASE_URL}} in host rather than reading it as a path segment", () => {
    expect(buildPostmanUrl("{{BASE_URL}}/users/:id")).toEqual({
      raw: "{{BASE_URL}}/users/:id",
      host: ["{{BASE_URL}}"],
      path: ["users", ":id"],
    });
  });

  it("splits the query string off a {{BASE_URL}} url", () => {
    expect(buildPostmanUrl("{{BASE_URL}}/users?active=true")).toEqual({
      raw: "{{BASE_URL}}/users?active=true",
      host: ["{{BASE_URL}}"],
      path: ["users"],
      query: [{ key: "active", value: "true" }],
    });
  });

  // an older collection, saved before environments existed, still has a real
  // absolute url — parsed the ordinary way rather than dropped
  it("parses a legacy absolute url into host, port and path", () => {
    expect(buildPostmanUrl("http://localhost:4000/api/users/:id")).toEqual({
      raw: "http://localhost:4000/api/users/:id",
      protocol: "http",
      host: ["localhost"],
      port: "4000",
      path: ["api", "users", ":id"],
    });
  });

  it("keeps an unparseable url as one raw path segment rather than dropping it", () => {
    expect(buildPostmanUrl("not a url")).toEqual({ raw: "not a url", host: [], path: ["not a url"] });
  });
});

describe("buildPostmanEnvironment", () => {
  it("carries the name and marks it as an environment scope", () => {
    const out = buildPostmanEnvironment({ name: "Staging", variables: [] }) as any;
    expect(out.name).toBe("Staging");
    expect(out._postman_variable_scope).toBe("environment");
    expect(typeof out.id).toBe("string");
    expect(out.id.length).toBeGreaterThan(0);
  });

  it("maps variables to Postman's key/value/type/enabled shape", () => {
    const out = buildPostmanEnvironment({
      name: "Local",
      variables: [{ key: "BASE_URL", value: "http://localhost:4000" }, { key: "token", value: "" }],
    }) as any;
    expect(out.values).toEqual([
      { key: "BASE_URL", value: "http://localhost:4000", type: "default", enabled: true },
      { key: "token", value: "", type: "default", enabled: true },
    ]);
  });
});

describe("parsePostmanCollection", () => {
  it("reads a flat request into ReqFlow's shape, disabled flipped back to enabled", () => {
    const out = parsePostmanCollection({
      item: [
        {
          name: "get users",
          request: {
            method: "get",
            header: [
              { key: "Authorization", value: "Bearer {{token}}", disabled: false },
              { key: "X-Debug", value: "1", disabled: true },
            ],
            url: { raw: "{{BASE_URL}}/users", host: ["{{BASE_URL}}"], path: ["users"] },
          },
        },
      ],
    });
    expect(out).toEqual([
      {
        name: "get users",
        method: "GET",
        url: "{{BASE_URL}}/users",
        headers: [
          { key: "Authorization", value: "Bearer {{token}}", enabled: true },
          { key: "X-Debug", value: "1", enabled: false },
        ],
        body: "",
      },
    ]);
  });

  it("takes a raw body but leaves other body modes empty rather than dropping the request", () => {
    const out = parsePostmanCollection({
      item: [
        {
          name: "create",
          request: {
            method: "POST",
            url: "{{BASE_URL}}/x",
            body: { mode: "raw", raw: '{"a":1}' },
          },
        },
        {
          name: "upload",
          request: {
            method: "POST",
            url: "{{BASE_URL}}/x",
            body: { mode: "formdata", formdata: [{ key: "file", type: "file" }] },
          },
        },
      ],
    });
    expect(out[0].body).toBe('{"a":1}');
    expect(out[1].body).toBe("");
  });

  it("flattens nested folders, prefixing the request name with the folder path", () => {
    const out = parsePostmanCollection({
      item: [
        {
          name: "Users",
          item: [{ name: "get", request: { method: "GET", url: "{{BASE_URL}}/users" } }],
        },
      ],
    });
    expect(out[0].name).toBe("Users/get");
  });

  it("reads a plain string url as-is", () => {
    const out = parsePostmanCollection({
      item: [{ name: "x", request: { method: "GET", url: "http://localhost:4000/x" } }],
    });
    expect(out[0].url).toBe("http://localhost:4000/x");
  });
});

describe("parsePostmanEnvironment", () => {
  it("keeps only enabled values, dropping type/id", () => {
    const out = parsePostmanEnvironment({
      name: "Staging",
      values: [
        { key: "BASE_URL", value: "https://staging.example.com", enabled: true },
        { key: "old", value: "unused", enabled: false },
      ],
    });
    expect(out).toEqual({
      name: "Staging",
      variables: [{ key: "BASE_URL", value: "https://staging.example.com" }],
    });
  });
});
