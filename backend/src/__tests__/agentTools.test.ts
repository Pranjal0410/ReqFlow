import {
  createRequest,
  createAssertions,
  runTool,
  MAX_ACTIONS_PER_CHAT,
  UiAction,
  ToolCtx,
} from "../routes/aiChat";

// the model decides what to call these with, so the guards here are what stops
// a plausible-looking tool call from writing something unusable into the tab

describe("create_request", () => {
  it("queues a drafted tab and never reports it as sent", () => {
    const actions: UiAction[] = [];
    const out: any = createRequest(
      {
        method: "post",
        url: "http://localhost:3001/incidents",
        headers: '{"Authorization":"Bearer abc"}',
        body: '{"severity":"high"}',
        label: "Create incident",
      },
      actions
    );

    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/not been sent/i);
    expect(actions).toEqual([
      {
        type: "create_request",
        method: "POST",
        url: "http://localhost:3001/incidents",
        headers: { Authorization: "Bearer abc" },
        // the model sends it on one line, the body editor gets it readable
        body: '{\n  "severity": "high"\n}',
        label: "Create incident",
      },
    ]);
  });

  it("leaves a body that is not json exactly as sent", () => {
    const actions: UiAction[] = [];
    createRequest(
      { method: "POST", url: "http://localhost:3001/hook", body: "name=widget&qty=2" },
      actions
    );
    expect((actions[0] as any).body).toBe("name=widget&qty=2");
  });

  it("rejects a call with no url", () => {
    const actions: UiAction[] = [];
    expect((createRequest({ method: "GET" }, actions) as any).error).toMatch(/url/i);
    expect(actions).toHaveLength(0);
  });

  it("survives headers that are not valid json", () => {
    const actions: UiAction[] = [];
    createRequest({ method: "GET", url: "http://x/y", headers: "not json" }, actions);
    expect((actions[0] as any).headers).toEqual({});
  });

  it("collapses a repeated draft of the same request", () => {
    const actions: UiAction[] = [];
    const args = { method: "GET", url: "http://localhost:3001/incidents" };

    createRequest(args, actions);
    const second: any = createRequest(args, actions);

    expect(second.duplicate).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it("labels a tab from the path when the model did not name one", () => {
    const actions: UiAction[] = [];
    createRequest({ method: "GET", url: "http://localhost:3001/incidents" }, actions);
    expect((actions[0] as any).label).toBe("GET /incidents");
  });
});

describe("create_assertions", () => {
  it("accepts the operators the frontend can actually evaluate", () => {
    const actions: UiAction[] = [];
    const out: any = createAssertions(
      {
        assertions: JSON.stringify([
          { field: "status", operator: "equals", value: 201 },
          { field: "timing", operator: "less than", value: 500 },
        ]),
      },
      actions
    );

    expect(out.added).toBe(2);
    // values are compared as strings downstream, so they are stored that way
    expect((actions[0] as any).assertions[0].value).toBe("201");
  });

  it("rewrites body.* to data.*, the root assertions really read from", () => {
    const actions: UiAction[] = [];
    const out: any = createAssertions(
      { assertions: JSON.stringify([{ field: "body.id", operator: "exists", value: "" }]) },
      actions
    );

    expect((actions[0] as any).assertions[0].field).toBe("data.id");
    expect(out.rewritten).toContain("body.id -> data.id");
  });

  it("refuses a field under a root that can never resolve", () => {
    const actions: UiAction[] = [];
    const out: any = createAssertions(
      { assertions: JSON.stringify([{ field: "response.id", operator: "exists", value: "" }]) },
      actions
    );

    expect(out.error).toMatch(/must start with/i);
    expect(actions).toHaveLength(0);
  });

  it("refuses an operator the frontend does not implement", () => {
    const actions: UiAction[] = [];
    const out: any = createAssertions(
      { assertions: JSON.stringify([{ field: "status", operator: "matches", value: "2.." }]) },
      actions
    );

    expect(out.error).toMatch(/matches/);
    expect(actions).toHaveLength(0);
  });

  it("keeps the valid assertions when only some are bad", () => {
    const actions: UiAction[] = [];
    const out: any = createAssertions(
      {
        assertions: JSON.stringify([
          { field: "status", operator: "equals", value: 200 },
          { field: "status", operator: "matches", value: "2.." },
        ]),
      },
      actions
    );

    expect(out.added).toBe(1);
    expect(out.rejected).toHaveLength(1);
  });

  it("adds only what is new when the model re-sends its earlier attempt", () => {
    const actions: UiAction[] = [];

    createAssertions(
      {
        assertions: JSON.stringify([
          { field: "status", operator: "equals", value: 201 },
          { field: "data.id", operator: "exists", value: "" },
        ]),
      },
      actions
    );

    const second: any = createAssertions(
      {
        assertions: JSON.stringify([
          { field: "status", operator: "equals", value: 201 },
          { field: "data.id", operator: "exists", value: "" },
          { field: "timing", operator: "less than", value: 500 },
        ]),
      },
      actions
    );

    expect(second.added).toBe(1);
    expect(second.skippedAsDuplicates).toBe(2);

    const all = actions.flatMap((a) => (a.type === "create_assertions" ? a.assertions : []));
    expect(all).toHaveLength(3);
  });

  it("reports a fully repeated call as a duplicate rather than an error", () => {
    const actions: UiAction[] = [];
    const args = {
      assertions: JSON.stringify([{ field: "status", operator: "equals", value: 200 }]),
    };

    createAssertions(args, actions);
    const second: any = createAssertions(args, actions);

    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it("rejects assertions that are not a json array", () => {
    const actions: UiAction[] = [];
    expect((createAssertions({ assertions: "nope" }, actions) as any).error).toMatch(/array/i);
    expect(actions).toHaveLength(0);
  });
});

// nothing is gated behind a confirmation any more, so the cap is the only thing
// standing between a confused model and an unbounded run

describe("action cap", () => {
  const ctx = (used = 0): ToolCtx => ({
    allowWrites: true,
    uiActions: [],
    log: [],
    vars: {},
    used,
  });

  const draft = (n: number) =>
    ({ name: "create_request", args: { method: "GET", url: `http://localhost:3001/r${n}` } }) as any;

  it("lets a normal run through untouched", async () => {
    const c = ctx();
    for (let i = 0; i < 5; i++) await runTool(draft(i), c);

    expect(c.used).toBe(5);
    expect(c.log).toHaveLength(5);
  });

  it("stops once the conversation budget is gone", async () => {
    const c = ctx();
    for (let i = 0; i < MAX_ACTIONS_PER_CHAT; i++) await runTool(draft(i), c);

    const over: any = await runTool(draft(99), c);

    expect(over.error).toMatch(/action limit/i);
    expect(c.used).toBe(MAX_ACTIONS_PER_CHAT);
    expect(c.log).toHaveLength(MAX_ACTIONS_PER_CHAT);
    expect(c.uiActions).toHaveLength(MAX_ACTIONS_PER_CHAT);
  });

  it("carries the count over from earlier turns in the same chat", async () => {
    const c = ctx(MAX_ACTIONS_PER_CHAT - 1);

    const last: any = await runTool(draft(1), c);
    const over: any = await runTool(draft(2), c);

    expect(last.ok).toBe(true);
    expect(last.actionsRemaining).toBe(0);
    expect(over.error).toMatch(/action limit/i);
  });

  it("does not charge for a call that did nothing", async () => {
    const c = ctx();

    await runTool(draft(1), c);
    await runTool(draft(1), c); // same request, collapsed as a duplicate
    await runTool({ name: "create_request", args: { method: "GET" } } as any, c); // no url
    await runTool(
      {
        name: "create_assertions",
        args: { assertions: JSON.stringify([{ field: "nope.x", operator: "exists" }]) },
      } as any,
      c
    );

    expect(c.used).toBe(1);
  });

  it("reports the remaining budget back to the model", async () => {
    const c = ctx();
    const out: any = await runTool(draft(1), c);
    expect(out.actionsRemaining).toBe(MAX_ACTIONS_PER_CHAT - 1);
  });
});

describe("set_variable", () => {
  const ctx = (): ToolCtx => ({ allowWrites: true, uiActions: [], log: [], vars: {}, used: 0 });

  it("stores a value and makes it usable for the rest of the turn", async () => {
    const c = ctx();
    const out: any = await runTool(
      { name: "set_variable", args: { name: "token", value: "abc123" } } as any,
      c
    );

    expect(out.ok).toBe(true);
    expect(c.uiActions).toEqual([{ type: "set_variable", name: "token", value: "abc123" }]);
    // available immediately, so a later call in the same turn can use {{token}}
    expect(c.vars.token).toBe("abc123");
  });

  it("rejects a name that {{...}} could never match", async () => {
    const c = ctx();
    const out: any = await runTool(
      { name: "set_variable", args: { name: "my token!", value: "x" } } as any,
      c
    );

    expect(out.error).toMatch(/not a usable variable name/i);
    expect(c.uiActions).toHaveLength(0);
  });

  it("does not spend a second action re-setting the same name", async () => {
    const c = ctx();
    await runTool({ name: "set_variable", args: { name: "token", value: "a" } } as any, c);
    const again: any = await runTool(
      { name: "set_variable", args: { name: "token", value: "a" } } as any,
      c
    );

    expect(again.duplicate).toBe(true);
    expect(c.used).toBe(1);
  });
});
