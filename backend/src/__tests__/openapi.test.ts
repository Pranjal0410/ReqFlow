import { buildOpenApi } from "../services/openapi";

describe("buildOpenApi", () => {
  const spec = (routes: any[]) =>
    buildOpenApi(routes, { title: "Test API", baseUrl: "http://localhost:3001" }) as any;

  it("converts express path params to openapi templates and marks them required", () => {
    const out = spec([
      { method: "GET", path: "/api/users/:id", description: "one user", params: ["id"], body: null },
    ]);

    const op = out.paths["/api/users/{id}"].get;
    expect(op.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
  });

  it("treats a scanned param that is not in the path as a query parameter", () => {
    const out = spec([
      { method: "GET", path: "/api/users", description: "list", params: ["page"], body: null },
    ]);

    expect(out.paths["/api/users"].get.parameters).toEqual([
      { name: "page", in: "query", required: false, schema: { type: "string" } },
    ]);
  });

  it("infers a request body schema without inventing examples for placeholders", () => {
    const out = spec([
      {
        method: "POST",
        path: "/api/incidents",
        description: "create",
        params: [],
        body: { title: "string", count: 3, open: true, tags: ["urgent"] },
      },
    ]);

    const schema =
      out.paths["/api/incidents"].post.requestBody.content["application/json"].schema;

    // "string" is the scan's placeholder for a value it never saw
    expect(schema.properties.title).toEqual({ type: "string" });
    expect(schema.properties.count).toEqual({ type: "integer", example: 3 });
    expect(schema.properties.open).toEqual({ type: "boolean", example: true });
    expect(schema.properties.tags).toEqual({
      type: "array",
      items: { type: "string", example: "urgent" },
    });
  });

  it("says the response shape is unknown rather than guessing one", () => {
    const out = spec([
      { method: "GET", path: "/api/users", description: "list", params: [], body: null },
    ]);
    expect(out.paths["/api/users"].get.responses.default.description).toMatch(/not captured/i);
  });

  it("puts two methods on the same path under one entry", () => {
    const out = spec([
      { method: "GET", path: "/api/incidents", description: "list", params: [], body: null },
      { method: "POST", path: "/api/incidents", description: "create", params: [], body: {} },
    ]);

    expect(Object.keys(out.paths["/api/incidents"]).sort()).toEqual(["get", "post"]);
  });

  it("records the base url as the server", () => {
    const out = spec([
      { method: "GET", path: "/x", description: "", params: [], body: null },
    ]);
    expect(out.servers).toEqual([{ url: "http://localhost:3001" }]);
  });
});
