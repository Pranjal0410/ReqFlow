import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { runCollection, withBaseUrl } from "../run";
import { parseArgs, findCollection } from "../index";

// A real server, because the thing being tested is a run against one. A mocked
// axios would prove the arguments were assembled, which is not the part that
// has ever been wrong.
function serve(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void>; seen: string[] }> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push(`${req.method} ${req.url}`);
        handler(req, body, res);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

const json = (res: http.ServerResponse, status: number, body: any) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

describe("running a collection", () => {
  it("sends each request and counts what held", async () => {
    const server = await serve((_req, _body, res) => json(res, 200, { ok: true }));
    const result = await runCollection({
      requests: [
        {
          name: "one",
          url: `${server.url}/a`,
          tests: [{ field: "status", operator: "equals", value: "200" }],
        },
      ],
    });
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0].status).toBe(200);
    await server.close();
  });

  // the reason the whole thing exists: the login at the top gives the requests
  // below it their token
  it("hands a captured value to the requests after it", async () => {
    const server = await serve((req, _body, res) => {
      if (req.url === "/login") return json(res, 200, { token: "abc123", user: { _id: "u-7" } });
      return json(res, 200, { auth: req.headers.authorization, path: req.url });
    });

    const result = await runCollection({
      requests: [
        {
          name: "log in",
          method: "POST",
          url: `${server.url}/login`,
          body: "{}",
          captures: [
            { from: "token", name: "token" },
            { from: "user._id", name: "userId" },
          ],
        },
        {
          name: "with the token",
          url: `${server.url}/me`,
          headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }],
          tests: [{ field: "data.auth", operator: "equals", value: "Bearer abc123" }],
        },
        {
          name: "with the id",
          url: `${server.url}/users/:id`,
          pathParams: { id: "{{userId}}" },
          tests: [{ field: "data.path", operator: "equals", value: "/users/u-7" }],
        },
      ],
    });

    expect(result.outcomes[0].captured).toEqual(["token", "userId"]);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(2);
    await server.close();
  });

  it("reports what an assertion actually saw, not only that it failed", async () => {
    const server = await serve((_req, _body, res) => json(res, 404, {}));
    const result = await runCollection({
      requests: [
        { name: "x", url: `${server.url}/a`, tests: [{ field: "status", operator: "equals", value: "200" }] },
      ],
    });
    expect(result.failed).toBe(1);
    expect(result.outcomes[0].failures[0]).toContain("was 404");
    await server.close();
  });

  // a 404 is an answer; only a request that could not be made is an error
  it("counts an unreachable host as could-not-send, not as a failed assertion", async () => {
    const result = await runCollection({
      requests: [{ name: "nowhere", url: "http://127.0.0.1:1/none" }],
    });
    expect(result.errored).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0].error).toBeTruthy();
  });

  it("does not send a header whose value is still a placeholder", async () => {
    const server = await serve((req, _body, res) => json(res, 200, { auth: req.headers.authorization ?? null }));
    const result = await runCollection({
      requests: [
        {
          name: "no token yet",
          url: `${server.url}/a`,
          headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }],
          tests: [{ field: "data.auth", operator: "exists", value: "" }],
        },
      ],
    });
    expect(result.failed).toBe(1);
    await server.close();
  });

  it("takes a value given on the command line for one the file cannot hold", async () => {
    const server = await serve((req, _body, res) => json(res, 200, { auth: req.headers.authorization }));
    const result = await runCollection(
      {
        variables: [{ key: "token", value: "" }],
        requests: [
          {
            name: "given a token",
            url: `${server.url}/a`,
            headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }],
            tests: [{ field: "data.auth", operator: "equals", value: "Bearer from-cli" }],
          },
        ],
      },
      { variables: { token: "from-cli" } }
    );
    expect(result.passed).toBe(1);
    await server.close();
  });

  it("has nothing to run in a file with no requests", async () => {
    await expect(runCollection({ requests: [] })).rejects.toThrow(/no requests/);
  });
});

describe("choosing an environment", () => {
  const collection = {
    environments: [
      { name: "Local", variables: [{ key: "token", value: "local-token" }] },
      { name: "Staging", variables: [{ key: "token", value: "staging-token" }] },
    ],
    requests: [
      {
        name: "who am i",
        url: "PLACEHOLDER",
        headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }],
      },
    ],
  };

  const against = (server: { url: string }) => ({
    ...collection,
    requests: [{ ...collection.requests[0], url: `${server.url}/a` }],
  });

  it("runs against the named environment's variables", async () => {
    const server = await serve((req, _body, res) => json(res, 200, { auth: req.headers.authorization }));
    const result = await runCollection(against(server), { env: "Staging" });
    expect(result.outcomes[0].status).toBe(200);
    await server.close();
  });

  it("is case-insensitive about the environment name", async () => {
    const server = await serve((req, _body, res) => json(res, 200, { auth: req.headers.authorization }));
    await runCollection(against(server), { env: "staging" });
    expect(server.seen).toHaveLength(1);
    await server.close();
  });

  it("defaults to the first environment when none is named", async () => {
    const server = await serve((req, _body, res) => json(res, 200, { auth: req.headers.authorization }));
    const result = await runCollection(against(server));
    expect(result.outcomes[0].status).toBe(200);
    await server.close();
  });

  it("fails clearly when the named environment does not exist", async () => {
    await expect(runCollection(collection, { env: "Prod" })).rejects.toThrow(/no environment named "Prod"/);
  });

  // a file written before environments existed still runs — folded into one
  // implied environment by the same reader the app uses
  it("still runs a v1 file with a flat baseUrl and variables", async () => {
    const server = await serve((req, _body, res) => json(res, 200, { auth: req.headers.authorization }));
    const result = await runCollection({
      baseUrl: server.url,
      variables: [{ key: "token", value: "legacy-token" }],
      requests: [
        {
          name: "legacy",
          url: `${server.url}/a`,
          headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }],
          tests: [{ field: "data.auth", operator: "equals", value: "Bearer legacy-token" }],
        },
      ],
    });
    expect(result.passed).toBe(1);
    await server.close();
  });
});

describe("pointing the same requests somewhere else", () => {
  it("keeps the path and replaces the origin", () => {
    expect(withBaseUrl("http://localhost:3001/api/users?page=2", "https://staging.example.com")).toBe(
      "https://staging.example.com/api/users?page=2"
    );
  });

  it("leaves the url alone when no base url was given", () => {
    expect(withBaseUrl("http://localhost:3001/api", undefined)).toBe("http://localhost:3001/api");
  });

  it("leaves alone what is not a url yet", () => {
    expect(withBaseUrl("{{host}}/api", "https://x.example.com")).toBe("{{host}}/api");
  });
});

describe("reading the command line", () => {
  it("takes the file, the base url and the variables", () => {
    const args = parseArgs(["run", "c.json", "--base-url", "http://x", "--var", "token=abc"]);
    expect(args).toMatchObject({ file: "c.json", baseUrl: "http://x", variables: { token: "abc" } });
  });

  it("takes the environment to run against", () => {
    expect(parseArgs(["run", "c.json", "--env", "Staging"]).env).toBe("Staging");
  });

  it("keeps an = inside the value", () => {
    expect(parseArgs(["--var", "token=a=b=c"]).variables).toEqual({ token: "a=b=c" });
  });

  it("ignores a --var with no name", () => {
    expect(parseArgs(["--var", "=abc"]).variables).toEqual({});
  });

  it("does not mistake run for the filename", () => {
    expect(parseArgs(["run"]).file).toBeNull();
  });
});

describe("finding the file", () => {
  it("looks up from where it was run", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-cli-"));
    const nested = path.join(root, "src", "routes");
    fs.mkdirSync(nested, { recursive: true });
    const file = path.join(root, "reqflow.collection.json");
    fs.writeFileSync(file, "{}");

    expect(findCollection(nested)).toBe(file);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("has nothing to say when there is none", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "reqflow-cli-empty-"));
    expect(findCollection(empty)).toBeNull();
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
