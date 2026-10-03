import http from "http";
import { startMock, stopMock, mockStatus, listMocks } from "../services/mockServer";

function get(port: number, path: string, method = "GET"): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, agent: false }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: JSON.parse(raw) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("mock server", () => {
  it("serves a configured sample response for a matching route", async () => {
    const { id, port } = await startMock([{ method: "GET", path: "/users/:id", sampleResponse: { name: "Sam" } }]);
    try {
      const { status, body } = await get(port, "/users/5");
      expect(status).toBe(200);
      expect(body).toEqual({ name: "Sam" });
    } finally {
      stopMock(id);
    }
  });

  it("404s with the list of what it does mock when nothing matches", async () => {
    const { id, port } = await startMock([{ method: "GET", path: "/users", sampleResponse: {} }]);
    try {
      const { status, body } = await get(port, "/orders");
      expect(status).toBe(404);
      expect(body.mocked).toEqual(["GET /users"]);
    } finally {
      stopMock(id);
    }
  });

  it("reports status while running and nothing once stopped", async () => {
    const { id, port } = await startMock([{ method: "GET", path: "/x" }]);
    expect(mockStatus(id)).toEqual({ running: true, port, routes: [{ method: "GET", path: "/x" }] });
    stopMock(id);
    expect(mockStatus(id)).toBeNull();
  });

  it("lists every mock still running, for a frontend that lost track of its own", async () => {
    const a = await startMock([{ method: "GET", path: "/a" }]);
    const b = await startMock([{ method: "GET", path: "/b" }]);
    try {
      const ids = listMocks().map((m) => m.id);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    } finally {
      stopMock(a.id);
      stopMock(b.id);
    }
    expect(listMocks().map((m) => m.id)).not.toEqual(expect.arrayContaining([a.id, b.id]));
  });
});
