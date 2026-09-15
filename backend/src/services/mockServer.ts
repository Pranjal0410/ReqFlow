// A fake server, for the endpoints a real one has not answered yet — or has
// nothing behind it at all. Given the requests the developer already built in
// ReqFlow, this stands up something on the same shapes so a frontend can be
// built against them before the backend exists, or a request can be replayed
// without hitting a real target.

import http, { Server } from "http";
import { randomUUID } from "crypto";

export interface MockRoute {
  method: string;
  path: string;
  sampleResponse?: any;
}

export interface MockInfo {
  id: string;
  port: number;
}

interface Running {
  server: Server;
  port: number;
  routes: MockRoute[];
}

const running = new Map<string, Running>();

// Express-style :name segments, matched the same way a real route would be —
// a literal segment has to match exactly, a :name one takes whatever is there
function matches(routePath: string, requestPath: string): boolean {
  const a = routePath.split("/").filter(Boolean);
  const b = requestPath.split("/").filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
}

function findRoute(routes: MockRoute[], method: string, path: string): MockRoute | null {
  return routes.find((r) => r.method.toUpperCase() === method.toUpperCase() && matches(r.path, path)) || null;
}

export function startMock(routes: MockRoute[]): Promise<MockInfo> {
  const id = randomUUID();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const route = findRoute(routes, req.method || "GET", url.pathname);

    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `no mock for ${req.method} ${url.pathname}`,
          mocked: routes.map((r) => `${r.method} ${r.path}`),
        })
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(route.sampleResponse ?? { mocked: true, method: route.method, path: route.path }));
  });

  // port 0 asks the OS for whichever is free — only known once "listening"
  // actually fires, so the caller waits for that rather than reading address()
  // on the same tick as listen(), when it is still null
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      running.set(id, { server, port, routes });
      resolve({ id, port });
    });
  });
}

export function stopMock(id: string): boolean {
  const entry = running.get(id);
  if (!entry) return false;
  entry.server.close();
  running.delete(id);
  return true;
}

export function mockStatus(id: string): { running: boolean; port: number; routes: MockRoute[] } | null {
  const entry = running.get(id);
  if (!entry) return null;
  return { running: true, port: entry.port, routes: entry.routes };
}
