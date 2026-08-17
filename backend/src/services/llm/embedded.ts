import fs from "fs";
import {
  ChatReply,
  ChatSession,
  LlmProvider,
  ProviderHealth,
  StartChatOptions,
  ToolDeclaration,
  ToolResult,
} from "./types";

// The model running inside this process. Not a daemon to install, not a port to
// keep alive, not a request that leaves the machine: the weights are mapped into
// the backend and llama.cpp answers from there. That is the point of ReqFlow
// being a desktop app at all — the model can live where the code does.
//
// node-llama-cpp is loaded on demand rather than at import. It carries a native
// binary, and requiring it up front would make the Gemini path depend on a build
// that path never uses. It is an optional dependency for the same reason.

// The library is ESM only and this backend is CommonJS, where TypeScript
// rewrites import() into require() and breaks on an ESM package. Going through
// Function keeps a real dynamic import in the output.
const esmImport: (specifier: string) => Promise<any> = new Function(
  "specifier",
  "return import(specifier)"
) as any;

// Loading weights takes seconds and holds gigabytes. One load is kept per file
// and shared by every request, because a load per request would mean a scan that
// spends longer opening the model than reading the project.
interface Loaded {
  llama: any;
  model: any;
  path: string;
  contextTokens: number;
}

let loaded: Promise<Loaded> | null = null;
let loadedPath: string | null = null;

// Room for the prompt, the project files inside it and the answer. Larger costs
// RAM for the KV cache on a machine that is also running the project under test,
// which is the machine this has to stay usable on.
const CONTEXT_TOKENS = Number(process.env.LOCAL_CONTEXT_TOKENS || 8192);

// Roughly four characters to a token for source code. Used only to refuse a
// prompt that cannot fit before spending a minute discovering it, so an estimate
// is the right tool — and it is never shown to anyone as a measurement.
const CHARS_PER_TOKEN = 4;

// what is left for the prompt once the answer has its room
const RESERVED_OUTPUT_TOKENS = 1536;

// A whole endpoint as JSON — two or three layers of code, escaped — is longer
// than a chat reply, and stopping at the cap ends mid-string. The grammar cannot
// save that: truncation is not a shape the sampler can refuse, it is the answer
// being cut off, and what comes back is unparseable however well formed it was
// on the way to being cut.
const RESERVED_JSON_TOKENS = 3072;

export function modelPath(): string {
  return process.env.LOCAL_MODEL_PATH || "";
}

async function load(): Promise<Loaded> {
  const file = modelPath();

  if (!file) {
    throw new Error(
      "No local model file is configured. Set LOCAL_MODEL_PATH to a .gguf file, or choose one in the desktop app."
    );
  }
  if (!fs.existsSync(file)) {
    throw new Error(`the model file ${file} is not there`);
  }

  // a changed path means a different model, and handing back the old one would
  // answer in the voice of a model the user has switched away from
  if (loaded && loadedPath !== file) {
    await dispose();
  }

  if (!loaded) {
    loadedPath = file;
    loaded = (async () => {
      let lib: any;
      try {
        lib = await esmImport("node-llama-cpp");
      } catch (err: any) {
        throw new Error(
          `node-llama-cpp is not installed, so no model can run in this process. Run "npm install node-llama-cpp" in backend/, or use LLM_PROVIDER=local with a separate runtime. (${err?.message})`
        );
      }

      const llama = await lib.getLlama();
      const model = await llama.loadModel({ modelPath: file });
      return { llama, model, path: file, contextTokens: CONTEXT_TOKENS };
    })().catch((err) => {
      // a failed load must not be cached, or every later request replays the
      // same failure without ever trying again
      loaded = null;
      loadedPath = null;
      throw err;
    });
  }

  return loaded;
}

export async function dispose(): Promise<void> {
  const current = loaded;
  loaded = null;
  loadedPath = null;
  if (!current) return;
  try {
    const { llama, model } = await current;
    await model.dispose();
    await llama.dispose();
  } catch {
    // shutting down is not worth an error nobody can act on
  }
}

// Asked to call a tool, Phi-4-mini writes `call: generate_code({...})` into its
// reply instead of emitting it through the library's function-calling channel.
// The model's own chat template has no tool protocol, so the library falls back
// to a text syntax the model imitates rather than produces, and nothing runs.
//
// So the tools are not offered to the model as functions at all. They are asked
// about, in JSON, under a grammar that makes the answer well formed by
// construction: the sampler cannot emit anything but a valid object of the shape
// we asked for, which leaves the model with only the decision to get right.
// Same lesson as the code generator — one prompt, one job.

// Local rounds cost ten seconds each rather than a network hop, so the ceiling
// is lower than the hosted loop's. The action budget in runTool is the real
// limit; this stops a model that keeps choosing tools from running all evening.
const MAX_LOCAL_TOOL_ROUNDS = 6;

// Writing an endpoint produces code that is not on the server yet, so anything
// sent to it in the same turn is a guaranteed 404 and a spent action. The hosted
// prompt says so and is obeyed. A 3.8B model asked "what next" keeps finding a
// next — three actions where one was wanted on one run, one on the next — so
// here the turn ends after this tool rather than the model being asked to end it.
const TERMINAL_TOOLS = new Set(["generate_code"]);

function describeTools(tools: ToolDeclaration[]): string {
  return tools
    .map((t) => `- ${t.name}: ${t.description.split(". ")[0]}.`)
    .join("\n");
}

async function pickTool(
  llama: any,
  lib: any,
  session: any,
  tools: ToolDeclaration[],
  request: string
): Promise<string> {
  const grammar = await llama.createGrammarForJsonSchema({
    type: "object",
    properties: { tool: { enum: [...tools.map((t) => t.name), "none"] } },
  });

  const answer = await session.prompt(
    `${request}

These are the tools available:
${describeTools(tools)}

Which single tool should run next? Answer "none" if the work is finished or if no tool fits.

Prefer "none". Do the one thing the user asked for and stop: a small model asked "what next" will keep finding a next, and each extra tool spends one of the user's actions on work nobody wanted. In particular, an endpoint that has just been written does not exist on the server yet, so there is nothing to send to it.`,
    { grammar, maxTokens: 64 }
  );

  return String(grammar.parse(answer)?.tool || "none");
}

async function askForArgs(
  llama: any,
  session: any,
  tool: ToolDeclaration
): Promise<Record<string, any>> {
  const grammar = await llama.createGrammarForJsonSchema({
    type: "object",
    properties: Object.fromEntries(
      Object.entries(tool.parameters.properties).map(([key, p]) => [key, { type: "string" }])
    ),
    required: tool.parameters.required,
  });

  const fields = Object.entries(tool.parameters.properties)
    .map(([key, p]) => `- ${key}: ${p.description}`)
    .join("\n");

  const answer = await session.prompt(
    `You are calling ${tool.name}. ${tool.description}

Its arguments:
${fields}

Give the arguments for the request above. Any url must be the full address including scheme and port, exactly as the system prompt gives it — a relative path is refused by the proxy and the action is wasted.`,
    { grammar, maxTokens: 512 }
  );

  const parsed = grammar.parse(answer);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export class EmbeddedProvider implements LlmProvider {
  readonly name = "embedded";
  readonly local = true;

  get model(): string {
    const file = modelPath();
    return file ? file.split("/").pop() || file : "none";
  }

  // What can be sent in one prompt. The scan batches against this rather than
  // handing over a project that cannot fit, which is the difference between a
  // local scan that works on a real repository and one that only works on the
  // example.
  get maxPromptChars(): number {
    return (CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS) * CHARS_PER_TOKEN;
  }

  async generateText(prompt: string): Promise<string> {
    const { llama, model } = await load();
    const lib = await esmImport("node-llama-cpp");

    if (prompt.length > this.maxPromptChars) {
      throw new Error(
        `that prompt is larger than this model's context. Raise LOCAL_CONTEXT_TOKENS, or use a model with more room.`
      );
    }

    const context = await model.createContext({ contextSize: CONTEXT_TOKENS });
    try {
      const session = new lib.LlamaChatSession({ contextSequence: context.getSequence() });
      return String(await session.prompt(prompt, { maxTokens: RESERVED_OUTPUT_TOKENS })).trim();
    } finally {
      // a context left open holds its KV cache, and a few of those is the whole
      // machine's memory
      await context.dispose();
      void llama;
    }
  }

  // Grammar-constrained, so the structure is guaranteed by the sampler rather
  // than hoped for. This is what makes a single call viable on a small model:
  // the format costs it nothing, and all of its attention goes to the code.
  // Splitting the work into simpler prompts was the alternative, and it cost
  // more than it saved — each layer was written without seeing the others, so
  // the router called a service function the service never exported.
  async generateJson(prompt: string, schema: object): Promise<any> {
    const { model } = await load();
    const lib = await esmImport("node-llama-cpp");
    const { llama } = await load();

    if (prompt.length > this.maxPromptChars) {
      throw new Error(
        `that prompt is larger than this model's context. Raise LOCAL_CONTEXT_TOKENS, or use a model with more room.`
      );
    }

    const grammar = await llama.createGrammarForJsonSchema(schema);
    const context = await model.createContext({ contextSize: CONTEXT_TOKENS });
    try {
      const session = new lib.LlamaChatSession({ contextSequence: context.getSequence() });
      const answer = await session.prompt(prompt, {
        grammar,
        maxTokens: RESERVED_JSON_TOKENS,
      });
      return grammar.parse(answer);
    } finally {
      await context.dispose();
    }
  }

  startChat({ system, history, tools, runTool }: StartChatOptions): ChatSession {
    let context: any = null;
    let session: any = null;
    let llama: any = null;
    let lib: any = null;

    const setup = async () => {
      if (session) return session;

      const loadedModel = await load();
      const model = loadedModel.model;
      llama = loadedModel.llama;
      lib = await esmImport("node-llama-cpp");

      context = await model.createContext({ contextSize: CONTEXT_TOKENS });
      session = new lib.LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: system,
      });

      // Replayed rather than reconstructed: the library keeps its own history
      // once a session exists, and the earlier turns are what let the model
      // answer "run that again" without being told what "that" was.
      if (history.length > 0) {
        session.setChatHistory([
          { type: "system", text: system },
          ...history.map((h) =>
            h.role === "user"
              ? { type: "user", text: h.content }
              : { type: "model", response: [h.content] }
          ),
        ]);
      }

      return session;
    };

    const close = async () => {
      const held = context;
      context = null;
      session = null;
      if (held) await held.dispose();
    };

    return {
      async send(message: string): Promise<ChatReply> {
        const chat = await setup();
        try {
          if (tools.length === 0 || !runTool) {
            const text = await chat.prompt(message, { maxTokens: RESERVED_OUTPUT_TOKENS });
            return { text: String(text).trim(), calls: [] };
          }

          const done: string[] = [];

          for (let round = 0; round < MAX_LOCAL_TOOL_ROUNDS; round++) {
            const request =
              round === 0
                ? `The user asked: ${message}`
                : `The user asked: ${message}\n\nSo far: ${done.join("; ")}`;

            const name = await pickTool(llama, lib, chat, tools, request);
            if (name === "none") break;

            const tool = tools.find((t) => t.name === name);
            if (!tool) break;

            const args = await askForArgs(llama, chat, tool);
            const result = await runTool({ name, args });

            // fed back in a sentence rather than as raw JSON: the next decision
            // is "is there more to do", and a wall of response body crowds out
            // the question
            done.push(
              (result as any)?.error
                ? `${name} failed: ${String((result as any).error).slice(0, 160)}`
                : `${name} ran`
            );

            if (TERMINAL_TOOLS.has(name)) break;
          }

          // The reply is written last, knowing what actually happened, rather
          // than predicted before the tools ran. The log under it comes from the
          // backend either way, so the two cannot disagree.
          const text = await chat.prompt(
            done.length
              ? `Tell the user what you did, in two sentences at most. What happened: ${done.join("; ")}. Do not invent anything that is not in that list.`
              : `Answer the user's question directly and briefly.`,
            { maxTokens: 400 }
          );

          // the tools already ran here, so the caller's loop has nothing left to
          // do and stops, which is correct
          return { text: String(text).trim(), calls: [] };
        } finally {
          await close();
        }
      },

      // Only reached by providers that hand their calls back. This one runs them
      // itself, so there is never anything outstanding to answer.
      async sendToolResults(_results: ToolResult[]): Promise<ChatReply> {
        return { text: "", calls: [] };
      },
    };
  }

  async health(): Promise<ProviderHealth> {
    const file = modelPath();
    const base = { ok: false, provider: this.name, model: this.model };

    if (!file) {
      return { ...base, detail: "no model file chosen yet" };
    }
    if (!fs.existsSync(file)) {
      return { ...base, detail: `${file} is not there` };
    }

    try {
      // A real load. The file existing says nothing about it being a model this
      // build can read, and finding that out at the first scan is finding it out
      // too late.
      await load();
      const size = fs.statSync(file).size;
      return {
        ...base,
        ok: true,
        detail: `loaded from ${file} (${(size / 1e9).toFixed(1)}GB), running in this process`,
      };
    } catch (err: any) {
      return { ...base, detail: String(err?.message || err) };
    }
  }
}
