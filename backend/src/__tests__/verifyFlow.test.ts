import express from "express";
import type { Server } from "http";
import { readId, fillPathParam, fillNamedParams,
  collectionOf,
  firstIdIn,
  nextStepFor,
  idsIn,
  hasInventedId,
  useKnownId,
  describeLookup,
  idFieldsIn,
  collectionForField,
  parseBody,
} from "../routes/generate";
import { waitForServer } from "../services/readiness";

describe("readId", () => {
  // the same spelling assertion fields use, so "data" is the response body
  it("reads a field out of the response body", () => {
    expect(readId({ id: 42 }, "data.id")).toBe("42");
    expect(readId({ user: { id: "u_1" } }, "data.user.id")).toBe("u_1");
  });

  it("returns nothing when the field is absent", () => {
    expect(readId({ name: "x" }, "data.id")).toBeNull();
    expect(readId({ user: null }, "data.user.id")).toBeNull();
    expect(readId("plain text", "data.id")).toBeNull();
  });

  // an object stringifies to [object Object], which would go into a url
  it("refuses a field that is not a scalar", () => {
    expect(readId({ id: { value: 1 } }, "data.id")).toBeNull();
  });

  it("returns nothing when no field was named", () => {
    expect(readId({ id: 1 }, null)).toBeNull();
  });

  // What the model actually returns. Asked for a path "under data", it answers
  // "id", because that is the field's name in the response it just wrote. Both
  // spellings point at the same value, and only accepting ours meant a working
  // endpoint being told its id was missing.
  it("accepts the field named without the data prefix", () => {
    expect(readId({ id: 3 }, "id")).toBe("3");
    expect(readId({ user: { id: "u_1" } }, "user.id")).toBe("u_1");
  });

  it("refuses the whole body as an id, however it was spelled", () => {
    expect(readId({ id: 1 }, "data")).toBeNull();
    expect(readId({ id: 1 }, "")).toBeNull();
  });
});

describe("fillPathParam", () => {
  it("substitutes the first placeholder", () => {
    expect(fillPathParam("/api/users/:id", "42")).toBe("/api/users/42");
    expect(fillPathParam("/api/users/:userId/posts", "7")).toBe("/api/users/7/posts");
  });

  it("escapes a value that would otherwise change the path", () => {
    expect(fillPathParam("/api/users/:id", "a/b")).toBe("/api/users/a%2Fb");
  });

  // left as it is, so the caller can see the placeholder survived and say the
  // id was missing rather than sending ":id" to the server
  it("leaves the path alone when there is no id", () => {
    expect(fillPathParam("/api/users/:id", null)).toBe("/api/users/:id");
  });

  it("passes through a path with no placeholder", () => {
    expect(fillPathParam("/api/users", "42")).toBe("/api/users");
  });
});

// The endpoint's own path parameters, as opposed to the id carried from a create
// response into the read-back. An endpoint whose path holds an :id cannot be
// called at all without one, and until this the literal ":id" went on the wire:
// DELETE /api/users/:id came back 404 and was reported as a broken endpoint
// rather than a request that was never properly formed.
describe("fillNamedParams", () => {
  it("fills a parameter by name", () => {
    expect(fillNamedParams("/api/users/:id", { id: "7" })).toBe("/api/users/7");
  });

  it("fills every parameter in the path", () => {
    expect(
      fillNamedParams("/api/users/:userId/posts/:postId", { userId: "3", postId: "9" })
    ).toBe("/api/users/3/posts/9");
  });

  // left as it is, so the caller can see the placeholder survived and say what
  // is missing rather than sending ":id" to the server
  it("leaves a parameter it has no value for", () => {
    expect(fillNamedParams("/api/users/:id", {})).toBe("/api/users/:id");
    expect(fillNamedParams("/api/users/:id", undefined)).toBe("/api/users/:id");
    expect(fillNamedParams("/api/users/:id/posts/:postId", { id: "1" })).toBe(
      "/api/users/1/posts/:postId"
    );
  });

  it("escapes a value that would otherwise change the path", () => {
    expect(fillNamedParams("/api/users/:id", { id: "a/b" })).toBe("/api/users/a%2Fb");
  });

  it("passes a path with no parameters through untouched", () => {
    expect(fillNamedParams("/api/users", { id: "1" })).toBe("/api/users");
  });

  // the model returns whatever it returns; a number is the common one
  it("takes a value that is not a string", () => {
    expect(fillNamedParams("/api/users/:id", { id: 4 as any })).toBe("/api/users/4");
  });
});

describe("waitForServer", () => {
  let server: Server;
  let origin: string;

  afterEach(() => {
    if (server?.listening) server.close();
  });

  it("reports a listening server as up, with the wait it measured", async () => {
    const app = express();
    app.get("/", (_req, res) => res.json({ ok: true }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as any).port}`;

    const readiness = await waitForServer(origin, 5000);
    expect(readiness.up).toBe(true);
    expect(readiness.waitedMs).toBeGreaterThan(0);
  });

  // a 404 still means a process answered, which is all readiness is asking
  it("counts any answer as up, including an error status", async () => {
    const app = express();
    app.use((_req, res) => res.status(500).json({ error: "broken" }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as any).port}`;

    expect((await waitForServer(origin, 5000)).up).toBe(true);
  });

  it("gives up on a port nothing is listening on", async () => {
    const readiness = await waitForServer("http://127.0.0.1:9", 1200);
    expect(readiness.up).toBe(false);
    expect(readiness.attempts).toBeGreaterThan(0);
  });

  // waiting out the full timeout to report something the guard knew instantly
  // would read as a hang
  it("returns at once for an address the proxy will not reach", async () => {
    const started = Date.now();
    const readiness = await waitForServer("http://example.com", 10_000);
    expect(readiness.up).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

// An endpoint that acts on one record could not be checked at all: its :id was
// not ours to invent, and a guessed one answers 404 in a way indistinguishable
// from a broken endpoint. So the value is taken from the developer's own running
// server instead — which is what they would do by hand.
describe("finding a record to act on", () => {
  it("knows which collection an :id belongs to", () => {
    expect(collectionOf("/api/incidents/:id/priority")).toBe("/api/incidents");
    expect(collectionOf("/api/users/:id")).toBe("/api/users");
  });

  it("has no collection to offer when the path has no parameter", () => {
    expect(collectionOf("/api/incidents")).toBeNull();
  });

  it("takes the first record's id, whatever the list is wrapped in", () => {
    expect(firstIdIn([{ id: 7, title: "outage" }])).toBe("7");
    expect(firstIdIn({ data: [{ _id: "abc123" }] })).toBe("abc123");
    expect(firstIdIn({ items: [{ uuid: "u-1" }] })).toBe("u-1");
    // the wrapper is whatever the project called it, not one of a fixed set
    expect(firstIdIn({ incidents: [{ _id: "6a7ed6be" }] })).toBe("6a7ed6be");
  });

  it("invents nothing when there is nothing to take", () => {
    // an empty list must leave the honest "not run" answer standing
    expect(firstIdIn([])).toBeNull();
    expect(firstIdIn({ data: [] })).toBeNull();
    expect(firstIdIn({ count: 0 })).toBeNull();
    expect(firstIdIn([{ title: "no id here" }])).toBeNull();
  });
});

// "Read your server's output, fix it, or undo with git" was shown under every
// failing outcome, including outcomes that are not failures. An endpoint asked
// to answer 409 when a record is already resolved, answering 409 on a record
// that is already resolved, has done exactly what was asked.
describe("what to tell the developer to do next", () => {
  it("says a conflict may be the endpoint working, not failing", () => {
    const step = nextStepFor(409, "POST", "/api/incidents/:id/resolve")!;
    expect(step).toMatch(/already|current state/i);
    expect(step).toMatch(/may be exactly what you asked/i);
    // and gives them somewhere to go
    expect(step).toMatch(/different state|request tab/i);
  });

  it("sends them to credentials on a 401, not to their server logs", () => {
    expect(nextStepFor(401, "GET", "/api/incidents")).toMatch(/credentials/i);
    expect(nextStepFor(401, "GET", "/api/incidents")).not.toMatch(/stack trace/i);
  });

  it("sends them to the body on a 400", () => {
    expect(nextStepFor(400, "POST", "/api/incidents")).toMatch(/request body/i);
  });

  it("sends them to the server output only when the server actually threw", () => {
    expect(nextStepFor(500, "POST", "/x")).toMatch(/threw|stack trace/i);
  });

  it("stays quiet when the status needs no direction", () => {
    expect(nextStepFor(200, "GET", "/x")).toBeNull();
    expect(nextStepFor(201, "POST", "/x")).toBeNull();
  });
});

// A record the endpoint refuses is not the same as an endpoint that does not
// work, so the next record is tried before giving up.
describe("collecting records to act on", () => {
  it("keeps every id, in order, not just the first", () => {
    expect(idsIn({ incidents: [{ _id: "a" }, { _id: "b" }, { _id: "c" }] })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("skips records that carry no id at all", () => {
    expect(idsIn([{ title: "no id" }, { id: 4 }])).toEqual(["4"]);
  });

  it("has nothing to offer for an empty list", () => {
    expect(idsIn({ incidents: [] })).toEqual([]);
  });
});

// A read-back that names a record nobody has seen.
//
// Asked for a route to confirm the change, a model answers with a real-looking
// ObjectId that exists in no database. Sent as written it answers 404 — and that
// 404 turned an endpoint which had just answered 200 into "Applied, not
// working". The id was never ours to send.
describe("read-back ids", () => {
  const REAL = "6a7ed6be257d1d048d253b9d";
  const INVENTED = "60d5ec49f3e4b8001f8e4d3a";

  it("spots an id this run never saw", () => {
    expect(hasInventedId(`/api/incidents/${INVENTED}/assignees`, [REAL])).toBe(true);
  });

  it("accepts the record the run actually used", () => {
    expect(hasInventedId(`/api/incidents/${REAL}/assignees`, [REAL])).toBe(false);
  });

  it("accepts an id read out of the create response", () => {
    expect(hasInventedId(`/api/incidents/${INVENTED}`, [INVENTED, null])).toBe(false);
  });

  it("leaves a path with no id in it alone", () => {
    expect(hasInventedId("/api/incidents", [REAL])).toBe(false);
    expect(hasInventedId("/api/incidents/latest", [REAL])).toBe(false);
  });

  it("recognises uuids and long numeric ids too", () => {
    expect(hasInventedId("/api/orders/550e8400-e29b-41d4-a716-446655440000", [])).toBe(true);
    expect(hasInventedId("/api/orders/1048576", [])).toBe(true);
    // a version number in a path is not a record id
    expect(hasInventedId("/api/v2/orders", [])).toBe(false);
  });

  it("puts the known record in place of the invented one", () => {
    expect(useKnownId(`/api/incidents/${INVENTED}/assignees`, REAL)).toBe(
      `/api/incidents/${REAL}/assignees`
    );
  });
});

// Three different reasons shared one sentence. A developer told "/api/incidents
// returned no record to use" cannot tell whether the list needs a login, is
// genuinely empty, or does not exist — and only one of those is fixed by
// creating a record.
describe("why no record could be found", () => {
  it("names the login when that is what is in the way", () => {
    const said = describeLookup("/api/incidents", 401);
    expect(said).toMatch(/needs a login/i);
    expect(said).toMatch(/ask the agent to log in/i);
    expect(said).not.toMatch(/is empty/i);
  });

  it("says the list is empty when it really is", () => {
    const said = describeLookup("/api/incidents", null);
    expect(said).toMatch(/is empty/i);
    expect(said).toMatch(/create one first/i);
    expect(said).not.toMatch(/login/i);
  });

  it("distinguishes a collection that does not exist", () => {
    expect(describeLookup("/api/incidents", 404)).toMatch(/does not exist on this server/i);
  });

  it("reports an unexpected status rather than guessing at it", () => {
    expect(describeLookup("/api/incidents", 500)).toMatch(/answered 500/);
  });

  it("says so plainly when the path has no collection above it", () => {
    expect(describeLookup(null, null)).toMatch(/no collection to take one from/i);
  });

  // every branch has to leave the developer somewhere to go
  it("always ends with something the developer can do", () => {
    for (const blocked of [401, 403, 404, 500, null]) {
      expect(describeLookup("/api/incidents", blocked)).toMatch(
        /request tab|ask the agent|create one first/i
      );
    }
  });
});

// A generated test body arrives holding "commanderId": "60d5ec49f3e4b8001f8b4568"
// — a real-looking ObjectId belonging to nobody. The endpoint validates that the
// user exists, correctly answers 400, and the run was reported as the endpoint
// not working when what was wrong was the request ReqFlow made up.
describe("ids in the request body", () => {
  it("spots the ones that name a record", () => {
    expect(idFieldsIn({ commanderId: "6a7ed6be257d1d048d253b9d" })).toEqual([
      { field: "commanderId", value: "6a7ed6be257d1d048d253b9d" },
    ]);
  });

  it("leaves ordinary fields alone", () => {
    expect(idFieldsIn({ title: "outage", priority: "high", count: 3 })).toEqual([]);
  });

  it("does not mistake a short string for an id", () => {
    expect(idFieldsIn({ status: "resolved", code: "AB12" })).toEqual([]);
  });

  it("looks for a person wherever the field calls them one", () => {
    for (const field of ["userId", "commanderId", "assigneeId", "ownerId", "authorId"]) {
      expect(collectionForField(field)[0]).toBe("/api/users");
    }
  });

  it("otherwise takes the collection from the field's own name", () => {
    expect(collectionForField("incidentId")).toContain("/api/incidents");
    expect(collectionForField("teamId")).toContain("/api/teams");
  });

  it("has nowhere to look when the field names nothing", () => {
    expect(collectionForField("id")).toEqual([]);
  });

  it("reads a body that arrived as a string, which is how it travels", () => {
    expect(parseBody('{"commanderId":"6a7ed6be257d1d048d253b9d"}')).toEqual({
      commanderId: "6a7ed6be257d1d048d253b9d",
    });
    expect(parseBody("not json")).toEqual({});
    expect(parseBody(null)).toEqual({});
  });
});
