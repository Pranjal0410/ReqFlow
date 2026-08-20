import {
  mergeIntoTabs,
  toCollection,
  fromCollection,
  serialise,
  headerForFile,
  bodyForFile,
  FORMAT,
} from "../collection";
import { RequestTab } from "../../types";

const tab = (over: Partial<RequestTab> = {}): RequestTab => ({
  id: "t1",
  method: "GET",
  url: "http://localhost:3001/api/incidents",
  body: "",
  headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
  response: null,
  loading: false,
  label: "GET /api/incidents",
  tests: [],
  captures: [],
  pathParams: {},
  ...over,
});

describe("writing the workspace out", () => {
  it("keeps what a request is made of", () => {
    const c = toCollection([tab()], [], "http://localhost:3001", "demo");
    expect(c.reqflow).toBe(FORMAT);
    expect(c.name).toBe("demo");
    expect(c.baseUrl).toBe("http://localhost:3001");
    expect(c.requests).toHaveLength(1);
    expect(c.requests[0]).toMatchObject({
      method: "GET",
      url: "http://localhost:3001/api/incidents",
      name: "GET /api/incidents",
    });
  });

  // the file exists to be committed, so the credential must never be in it —
  // but emptying the header left three requests authenticating with nothing,
  // so the shape stays and the name says what to supply
  it("keeps the scheme of a credential header and names what it needs", () => {
    const c = toCollection(
      [tab({ headers: [{ key: "Authorization", value: "Bearer real-token", enabled: true }] })],
      [],
      "",
      "x"
    );
    expect(c.requests[0].headers).toEqual([
      { key: "Authorization", value: "Bearer {{token}}", enabled: true },
    ]);
    expect(c.variables).toContainEqual({ key: "token", value: "" });
  });

  // emptying this one too left a collection that could not authenticate, which
  // is a collection that cannot be run
  it("keeps a header that only refers to a variable", () => {
    const c = toCollection(
      [tab({ headers: [{ key: "Authorization", value: "Bearer {{token}}", enabled: true }] })],
      [],
      "",
      "x"
    );
    expect(c.requests[0].headers[0].value).toBe("Bearer {{token}}");
  });

  it("turns a password in a login body into a placeholder, and says it needs one", () => {
    const c = toCollection(
      [tab({ method: "POST", body: '{"email":"a@b.com","password":"hunter2"}' })],
      [],
      "",
      "x"
    );
    expect(JSON.parse(c.requests[0].body)).toEqual({ email: "a@b.com", password: "{{password}}" });
    expect(c.variables).toContainEqual({ key: "password", value: "" });
  });

  it("leaves a body alone when it holds nothing sensitive", () => {
    const c = toCollection([tab({ method: "POST", body: '{"title":"Database down"}' })], [], "", "x");
    expect(JSON.parse(c.requests[0].body)).toEqual({ title: "Database down" });
    expect(c.variables).toEqual([]);
  });

  it("writes a credential variable out empty too", () => {
    const c = toCollection([tab()], [{ key: "token", value: "jwt" }, { key: "page", value: "2" }], "", "x");
    expect(c.variables).toEqual([
      { key: "token", value: "" },
      { key: "page", value: "2" },
    ]);
  });

  it("carries the assertions and the captures, without their results", () => {
    const c = toCollection(
      [
        tab({
          tests: [{ id: "a", field: "status", operator: "equals", value: "200", passed: true }],
          captures: [{ id: "b", from: "data.id", name: "incidentId", lastValue: "inc-1" }],
        }),
      ],
      [],
      "",
      "x"
    );
    expect(c.requests[0].tests).toEqual([{ field: "status", operator: "equals", value: "200" }]);
    expect(c.requests[0].captures).toEqual([{ from: "data.id", name: "incidentId" }]);
  });

  it("leaves out a tab that was opened and never filled in", () => {
    expect(toCollection([tab({ url: "  " })], [], "", "x").requests).toHaveLength(0);
  });

  it("serialises as json a person can read and a diff can show", () => {
    const text = serialise(toCollection([tab()], [], "", "x"));
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).requests).toHaveLength(1);
  });
});

describe("reading one back", () => {
  it("round trips what the app wrote", () => {
    const written = toCollection(
      [tab({ captures: [{ id: "c", from: "token", name: "token", lastValue: null }] })],
      [{ key: "page", value: "2" }],
      "http://localhost:3001",
      "demo"
    );
    const back = fromCollection(JSON.parse(serialise(written)))!;
    expect(back.name).toBe("demo");
    expect(back.baseUrl).toBe("http://localhost:3001");
    expect(back.variables).toEqual([{ key: "page", value: "2" }]);
    expect(back.tabs).toHaveLength(1);
    expect(back.tabs[0].url).toBe("http://localhost:3001/api/incidents");
    expect(back.tabs[0].captures).toEqual([
      expect.objectContaining({ from: "token", name: "token", lastValue: null }),
    ]);
  });

  it("gives every request its own id, so two do not share a tab", () => {
    const back = fromCollection({
      requests: [{ url: "http://a/1" }, { url: "http://a/2" }],
    })!;
    expect(back.tabs[0].id).not.toBe(back.tabs[1].id);
  });

  // these files get hand written once they live in a repository
  it("fills in what a hand written file leaves out", () => {
    const back = fromCollection({ requests: [{ url: "http://localhost/api" }] })!;
    expect(back.tabs[0]).toMatchObject({
      method: "GET",
      body: "",
      headers: [],
      tests: [],
      captures: [],
      pathParams: {},
    });
  });

  it("takes the requests it can read and drops the ones it cannot", () => {
    const back = fromCollection({
      requests: [{ url: "http://a/1" }, { method: "POST" }, { url: "" }],
    })!;
    expect(back.tabs).toHaveLength(1);
  });

  it("has nothing to import from something that is not a collection", () => {
    expect(fromCollection(null)).toBeNull();
    expect(fromCollection({})).toBeNull();
    expect(fromCollection({ requests: [] })).toBeNull();
    expect(fromCollection({ requests: [{ method: "GET" }] })).toBeNull();
  });

  it("upper cases a method someone typed in lower case", () => {
    expect(fromCollection({ requests: [{ url: "http://a", method: "post" }] })!.tabs[0].method).toBe(
      "POST"
    );
  });

  it("treats a header without enabled as one that is on", () => {
    const back = fromCollection({
      requests: [{ url: "http://a", headers: [{ key: "X", value: "1" }] }],
    })!;
    expect(back.tabs[0].headers[0].enabled).toBe(true);
  });
});


describe("deciding what a file may carry", () => {
  it("keeps a reference as written", () => {
    expect(headerForFile("Authorization", "Bearer {{token}}")).toEqual({
      value: "Bearer {{token}}",
      needs: [],
    });
  });

  it("turns a real credential into the shape of one", () => {
    expect(headerForFile("Authorization", "Bearer eyJhbGciOi")).toEqual({
      value: "Bearer {{token}}",
      needs: ["token"],
    });
  });

  it("names any other credential header after itself", () => {
    expect(headerForFile("X-Api-Key", "live-abc")).toEqual({
      value: "{{X-Api-Key}}",
      needs: ["X-Api-Key"],
    });
  });

  it("has nothing to replace in an empty one", () => {
    expect(headerForFile("Authorization", "")).toEqual({ value: "", needs: [] });
  });

  it("leaves an ordinary header alone whatever it says", () => {
    expect(headerForFile("Content-Type", "application/json")).toEqual({
      value: "application/json",
      needs: [],
    });
  });

  it("names what it took out of a body so a runner can supply it", () => {
    const { body, needs } = bodyForFile('{"apiKey":"live-1234"}');
    expect(JSON.parse(body)).toEqual({ apiKey: "{{apiKey}}" });
    expect(needs).toEqual(["apiKey"]);
  });

  it("does not replace a placeholder that is already there", () => {
    const { body, needs } = bodyForFile('{"password":"{{password}}"}');
    expect(JSON.parse(body)).toEqual({ password: "{{password}}" });
    expect(needs).toEqual([]);
  });

  it("reaches a secret nested inside", () => {
    const { body } = bodyForFile('{"auth":{"token":"abc"}}');
    expect(JSON.parse(body)).toEqual({ auth: { token: "{{token}}" } });
  });

  it("has nothing to do to an empty body", () => {
    expect(bodyForFile("")).toEqual({ body: "", needs: [] });
  });
});


describe("loading a collection into a workspace that is already open", () => {
  const open = tab({
    id: "already-open",
    tests: [],
    captures: [],
    response: { status: 200 } as any,
  });

  // loading a collection you had just saved used to give you two of every tab
  it("brings a matching tab up to date instead of adding a second one", () => {
    const loaded = tab({
      id: "from-file",
      tests: [{ id: "t", field: "status", operator: "equals", value: "200", passed: null }],
    });

    const merged = mergeIntoTabs([open], [loaded]);
    expect(merged).toHaveLength(1);
    expect(merged[0].tests).toHaveLength(1);
  });

  it("keeps the open tab's id, because that is what the active tab is tracked by", () => {
    const merged = mergeIntoTabs([open], [tab({ id: "from-file" })]);
    expect(merged[0].id).toBe("already-open");
  });

  // the response belongs to a request that was actually sent
  it("does not clear a response the tab already has", () => {
    const merged = mergeIntoTabs([open], [tab({ id: "from-file", response: null })]);
    expect(merged[0].response).toEqual({ status: 200 });
  });

  it("adds a request that has no tab open", () => {
    const merged = mergeIntoTabs([open], [tab({ id: "other", url: "http://localhost:3001/api/other" })]);
    expect(merged).toHaveLength(2);
  });

  // a file is a saved subset of a workspace, not a claim about the rest of it
  it("leaves an open tab the file says nothing about alone", () => {
    const untouched = tab({ id: "mine", url: "http://localhost:3001/api/mine" });
    expect(mergeIntoTabs([untouched], []).map((t) => t.id)).toEqual(["mine"]);
  });

  it("tells a GET from a POST at the same url", () => {
    const merged = mergeIntoTabs([open], [tab({ id: "post", method: "POST" })]);
    expect(merged).toHaveLength(2);
  });
});
