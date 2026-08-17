import express from "express";
import type { Server } from "http";
import { LocalProvider } from "../services/llm/local";
import { providerName, stripFences } from "../services/llm";
import { batchFiles } from "../services/gemini";
import { ToolDeclaration } from "../services/llm/types";

// A stand-in for Ollama. The point of the OpenAI-compatible shape is that the
// runtime is interchangeable, so the tests talk to the shape rather than to any
// one of them, and nothing here needs a model on disk.
function fakeRuntime(handler: (body: any) => any, models: string[] = ["phi4"]) {
  const app = express();
  app.use(express.json());
  app.get("/v1/models", (_req, res) => res.json({ data: models.map((id) => ({ id })) }));
  app.post("/v1/chat/completions", (req, res) => {
    const answer = handler(req.body);
    if (answer?.__status) return res.status(answer.__status).json(answer.body);
    res.json({ choices: [{ message: answer }] });
  });
  return app;
}

const TOOLS: ToolDeclaration[] = [
  {
    name: "send_request",
    description: "send one",
    parameters: {
      properties: { url: { type: "string", description: "the url" } },
      required: ["url"],
    },
  },
];

describe("LocalProvider", () => {
  let server: Server;
  let baseUrl: string;

  const start = (app: express.Express) =>
    new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`;
        resolve();
      });
    });

  afterEach(() => {
    if (server?.listening) server.close();
  });

  it("returns the completion text", async () => {
    await start(fakeRuntime(() => ({ role: "assistant", content: "  hello  " })));
    expect(await new LocalProvider("phi4", baseUrl).generateText("hi")).toBe("hello");
  });

  it("sends the system prompt and the history in order", async () => {
    let seen: any[] = [];
    await start(
      fakeRuntime((body) => {
        seen = body.messages;
        return { role: "assistant", content: "ok" };
      })
    );

    const chat = new LocalProvider("phi4", baseUrl).startChat({
      system: "you are reqflow",
      history: [{ role: "user", content: "earlier" }],
      tools: [],
    });
    await chat.send("now");

    expect(seen.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(seen[0].content).toBe("you are reqflow");
    expect(seen[2].content).toBe("now");
  });

  it("translates a tool declaration into the openai shape", async () => {
    let seen: any = null;
    await start(
      fakeRuntime((body) => {
        seen = body.tools;
        return { role: "assistant", content: "ok" };
      })
    );

    await new LocalProvider("phi4", baseUrl)
      .startChat({ system: "s", history: [], tools: TOOLS })
      .send("go");

    expect(seen[0].type).toBe("function");
    expect(seen[0].function.name).toBe("send_request");
    expect(seen[0].function.parameters.required).toEqual(["url"]);
  });

  it("reads tool calls out of a reply, arguments included", async () => {
    await start(
      fakeRuntime(() => ({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "send_request", arguments: '{"url":"http://localhost:3000"}' },
          },
        ],
      }))
    );

    const reply = await new LocalProvider("phi4", baseUrl)
      .startChat({ system: "s", history: [], tools: TOOLS })
      .send("test it");

    expect(reply.calls).toEqual([
      { name: "send_request", args: { url: "http://localhost:3000" } },
    ]);
  });

  // small models get this wrong often enough that it cannot throw: a tool run
  // with no arguments does something, and doing the wrong thing is worse than
  // telling the model its call was unreadable
  it("drops a call whose arguments are not json instead of running it blank", async () => {
    await start(
      fakeRuntime(() => ({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "send_request", arguments: "url=x" } },
        ],
      }))
    );

    const reply = await new LocalProvider("phi4", baseUrl)
      .startChat({ system: "s", history: [], tools: TOOLS })
      .send("test it");

    expect(reply.calls).toEqual([]);
  });

  it("carries tool results back with the id the call came with", async () => {
    let second: any[] = [];
    let round = 0;
    await start(
      fakeRuntime((body) => {
        round++;
        if (round === 1) {
          return {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call-7", type: "function", function: { name: "send_request", arguments: "{}" } },
            ],
          };
        }
        second = body.messages;
        return { role: "assistant", content: "done" };
      })
    );

    const chat = new LocalProvider("phi4", baseUrl).startChat({
      system: "s",
      history: [],
      tools: TOOLS,
    });
    await chat.send("test it");
    const reply = await chat.sendToolResults([{ name: "send_request", response: { status: 200 } }]);

    const toolMessage = second.find((m) => m.role === "tool");
    expect(toolMessage.tool_call_id).toBe("call-7");
    expect(JSON.parse(toolMessage.content)).toEqual({ status: 200 });
    expect(reply.text).toBe("done");
  });

  describe("health", () => {
    it("is ok when the runtime has the model", async () => {
      await start(fakeRuntime(() => ({ role: "assistant", content: "ok" }), ["phi4"]));
      const health = await new LocalProvider("phi4", baseUrl).health();
      expect(health.ok).toBe(true);
    });

    // a runtime that is up but has never pulled the model would otherwise fail
    // at the first real request, long after the point where it could be fixed
    it("is not ok when the model has not been pulled", async () => {
      await start(fakeRuntime(() => ({ role: "assistant", content: "ok" }), ["llama3"]));
      const health = await new LocalProvider("phi4", baseUrl).health();
      expect(health.ok).toBe(false);
      expect(health.detail).toContain("ollama pull phi4");
    });

    it("says nothing is listening rather than throwing", async () => {
      const health = await new LocalProvider("phi4", "http://127.0.0.1:9/v1").health();
      expect(health.ok).toBe(false);
      expect(health.detail).toContain("nothing is listening");
    });

    // a tag counts: "phi4:latest" is the model the user asked for
    it("accepts a tagged version of the model", async () => {
      await start(fakeRuntime(() => ({ role: "assistant", content: "ok" }), ["phi4:latest"]));
      expect((await new LocalProvider("phi4", baseUrl).health()).ok).toBe(true);
    });
  });

  it("names the pull command when the runtime 404s the model", async () => {
    await start(fakeRuntime(() => ({ __status: 404, body: { error: "model not found" } })));
    await expect(new LocalProvider("phi4", baseUrl).generateText("hi")).rejects.toThrow(
      /ollama pull phi4/
    );
  });
});

describe("providerName", () => {
  const original = process.env.LLM_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original;
  });

  // the cloud provider stays the default: turning the local one on is a choice,
  // and a typo in the setting must not silently point at a model nobody started
  it("defaults to gemini and only switches on an exact match", () => {
    delete process.env.LLM_PROVIDER;
    expect(providerName()).toBe("gemini");

    process.env.LLM_PROVIDER = "local";
    expect(providerName()).toBe("local");

    process.env.LLM_PROVIDER = "LOCAL";
    expect(providerName()).toBe("local");

    process.env.LLM_PROVIDER = "ollama";
    expect(providerName()).toBe("gemini");
  });
});

describe("stripFences", () => {
  it("removes the fences every model adds sooner or later", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

// A hosted model takes an 800k character project in one prompt. A model on a
// laptop has a few thousand tokens, so the scan either batches or only ever
// works on toy projects.
describe("batchFiles", () => {
  const file = (name: string, size: number) => ({ path: name, content: "x".repeat(size) });

  it("keeps everything in one batch when there is no limit", () => {
    const files = [file("a.js", 100), file("b.js", 100)];
    expect(batchFiles(files, 0)).toEqual([files]);
  });

  it("splits once the budget is used up", () => {
    const batches = batchFiles([file("a.js", 60), file("b.js", 60), file("c.js", 60)], 100);
    expect(batches.map((b) => b.map((f) => f.path))).toEqual([["a.js"], ["b.js"], ["c.js"]]);
  });

  it("fills a batch before starting the next", () => {
    const batches = batchFiles([file("a.js", 40), file("b.js", 40), file("c.js", 40)], 100);
    expect(batches.map((b) => b.map((f) => f.path))).toEqual([["a.js", "b.js"], ["c.js"]]);
  });

  // half a router describes routes whose handlers the model cannot see, and the
  // ones it invents to fill the gap are worse than the ones it would have missed
  it("never splits inside a file, even one over the budget", () => {
    const batches = batchFiles([file("huge.js", 500)], 100);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].path).toBe("huge.js");
  });

  it("returns nothing for nothing", () => {
    expect(batchFiles([], 100)).toEqual([]);
    expect(batchFiles([], 0)).toEqual([]);
  });
});

// The language tag has to come off with the fence. Leaving "javascript" behind
// produces something that still parses — a bare identifier is valid JavaScript —
// so it passed the syntax check, went into the project, and took the server down
// with "javascript is not defined".
describe("stripFences with a language tag", () => {
  it("removes the tag along with the backticks", () => {
    expect(stripFences("```javascript\nrouter.post('/', x);\n```")).toBe("router.post('/', x);");
    expect(stripFences("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(stripFences("```JSON\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("handles a fence that was never closed", () => {
    expect(stripFences("```javascript\nrouter.post('/', x);")).toBe("router.post('/', x);");
  });

  it("keeps a fence that is part of the content alone", () => {
    expect(stripFences("const md = '```';")).toBe("const md = '```';");
  });

  it("leaves unfenced text as it is", () => {
    expect(stripFences("router.post('/', x);")).toBe("router.post('/', x);");
  });
});
