import { deriveFileRoutes, isFileRoute } from "../services/frameworkRoutes";
import { mergeFileRoutes } from "../services/gemini";

const GET_POST = `
import { NextResponse } from "next/server";
export async function GET(req: Request) { return NextResponse.json([]); }
export async function POST(req: Request) { return NextResponse.json({}, { status: 201 }); }
`;

const derive = (path: string, content = GET_POST) =>
  deriveFileRoutes([{ path, content }]).map((r) => `${r.method} ${r.path}`);

// A Next.js route file states neither its path nor its method: the folder is
// the url and an exported function name is the verb. Reading the code alone
// finds nothing, which is why these projects used to scan to zero endpoints.
describe("deriveFileRoutes, app router", () => {
  it("reads the url out of the folder and the method out of the export", () => {
    expect(derive("/p/app/api/products/route.ts")).toEqual([
      "GET /api/products",
      "POST /api/products",
    ]);
  });

  it("works under src/ as well as at the root", () => {
    expect(derive("/p/src/app/api/stores/route.ts")).toEqual([
      "GET /api/stores",
      "POST /api/stores",
    ]);
  });

  it("turns a dynamic segment into a path parameter", () => {
    expect(derive("/p/app/api/stores/[storeId]/route.ts")).toEqual([
      "GET /api/stores/:storeId",
      "POST /api/stores/:storeId",
    ]);
  });

  it("collapses a catch-all into one parameter", () => {
    expect(derive("/p/app/api/files/[...path]/route.ts")[0]).toBe("GET /api/files/:path");
    expect(derive("/p/app/api/files/[[...path]]/route.ts")[0]).toBe("GET /api/files/:path");
  });

  // a route group is a folder that organises code without appearing in the url,
  // so including it produces a path that 404s
  it("drops route groups, parallel routes and private folders", () => {
    expect(derive("/p/app/(admin)/api/users/route.ts")[0]).toBe("GET /api/users");
    expect(derive("/p/app/api/@modal/users/route.ts")[0]).toBe("GET /api/users");
    expect(derive("/p/app/api/_internal/users/route.ts")[0]).toBe("GET /api/users");
  });

  it("reads a route file at the app root as /", () => {
    expect(derive("/p/app/route.ts")[0]).toBe("GET /");
  });

  it("finds a handler exported as a const", () => {
    expect(derive("/p/app/api/x/route.ts", "export const DELETE = async () => {};")).toEqual([
      "DELETE /api/x",
    ]);
  });

  it("returns nothing for a page, which is not an endpoint", () => {
    expect(derive("/p/app/dashboard/page.tsx", "export default function Page() {}")).toEqual([]);
  });
});

describe("deriveFileRoutes, pages router", () => {
  const handler = (body: string) => `export default function handler(req, res) { ${body} }`;

  it("reads the url out of the file path", () => {
    expect(derive("/p/pages/api/hello.ts", handler("res.json({})"))).toEqual(["GET /api/hello"]);
  });

  it("treats index as the folder itself", () => {
    expect(derive("/p/pages/api/users/index.ts", handler("res.json([])"))[0]).toBe("GET /api/users");
  });

  it("turns [id] into a parameter", () => {
    expect(derive("/p/pages/api/users/[id].ts", handler("res.json({})"))[0]).toBe(
      "GET /api/users/:id"
    );
  });

  // one handler serves every method, so the methods have to come out of the
  // branching inside it
  it("reads the methods out of the branch on req.method", () => {
    const branching = handler(`
      if (req.method === "POST") return res.status(201).json({});
      if (req.method === "DELETE") return res.status(204).end();
      res.json({});
    `);
    expect(derive("/p/pages/api/users.ts", branching).sort()).toEqual([
      "DELETE /api/users",
      "POST /api/users",
    ]);
  });

  it("falls back to GET when the handler does not branch", () => {
    expect(derive("/p/pages/api/ping.ts", handler("res.end()"))).toEqual(["GET /api/ping"]);
  });
});

describe("isFileRoute", () => {
  it("recognises the files a keyword search would miss", () => {
    expect(isFileRoute("/p/app/api/x/route.ts")).toBe(true);
    expect(isFileRoute("/p/pages/api/x.js")).toBe(true);
  });

  it("leaves ordinary source alone", () => {
    expect(isFileRoute("/p/src/routes/users.js")).toBe(false);
    expect(isFileRoute("/p/app/dashboard/page.tsx")).toBe(false);
  });
});

// the prompt asks the model not to drop a derived route. mostly is not good
// enough for one we already know exists.
describe("mergeFileRoutes", () => {
  const derived = [
    { method: "GET", path: "/api/products", file: "app/api/products/route.ts" },
    { method: "POST", path: "/api/products", file: "app/api/products/route.ts" },
  ];

  it("adds back a route the model left out", () => {
    const merged = mergeFileRoutes(
      [{ method: "GET", path: "/api/products", description: "lists products", params: [], body: null }],
      derived
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].description).toBe("lists products");
    expect(merged[1].method).toBe("POST");
  });

  it("keeps the model's version rather than overwriting it", () => {
    const rich = {
      method: "POST",
      path: "/api/products",
      description: "creates a product",
      params: [],
      body: { name: "Widget", price: 9.99 },
    };
    const merged = mergeFileRoutes([rich], derived);

    expect(merged.filter((r) => r.method === "POST")).toEqual([rich]);
  });

  it("fills in path params for a route it had to add itself", () => {
    const merged = mergeFileRoutes(
      [],
      [{ method: "GET", path: "/api/stores/:storeId", file: "app/api/stores/[storeId]/route.ts" }]
    );

    expect(merged[0].params).toEqual(["storeId"]);
    expect(merged[0].body).toBeNull();
  });

  it("leaves an express project untouched", () => {
    const routes = [{ method: "GET", path: "/users", description: "x", params: [], body: null }];
    expect(mergeFileRoutes(routes, [])).toEqual(routes);
  });
});
