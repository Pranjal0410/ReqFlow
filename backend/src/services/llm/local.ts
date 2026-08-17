import axios from "axios";
import {
  ChatReply,
  ChatSession,
  LlmProvider,
  ProviderHealth,
  StartChatOptions,
  ToolDeclaration,
  ToolResult,
} from "./types";

// A model running on this machine. It is reached over the OpenAI-compatible
// /chat/completions shape rather than through any one runtime's own SDK,
// because Ollama, llama.cpp's server and LM Studio all speak it: whichever the
// developer already has is the one this works with, and none of them has to be
// bundled.
//
// The default model name is only a default: whoever runs their own runtime has
// already chosen what to pull, and LOCAL_MODEL is how they say so.
//
// The weights are not shipped with ReqFlow. They are several gigabytes, they
// have their own licence, and putting them in a repository or a .dmg is a
// decision for whoever distributes the app rather than a side effect of turning
// this option on. Pulling the model is the whole setup.

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL = "phi4";

// Local generation is slower than a cloud call and the whole point is that it is
// not being billed, so it is given room. A scan of a large project is the case
// that needs it.
const REQUEST_TIMEOUT_MS = 300_000;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toOpenAiTools(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, p]) => [
            key,
            { type: "string", description: p.description },
          ])
        ),
        required: t.parameters.required,
      },
    },
  }));
}

// Small models return arguments as a JSON string, and sometimes as a string that
// is not quite JSON. A call we cannot read is dropped rather than passed on as
// an empty one: a tool invoked with no arguments does something, and doing the
// wrong thing is worse than reporting that the model did not make sense.
function readArgs(raw: unknown): Record<string, any> | null {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export class LocalProvider implements LlmProvider {
  readonly name = "local";
  readonly local = true;
  readonly model: string;
  private baseUrl: string;

  constructor(model?: string, baseUrl?: string) {
    this.model = model || process.env.LOCAL_MODEL || DEFAULT_MODEL;
    this.baseUrl = (baseUrl || process.env.LOCAL_MODEL_URL || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ""
    );
  }

  private async complete(messages: ChatMessage[], tools?: ToolDeclaration[]) {
    const res = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages,
        ...(tools && tools.length ? { tools: toOpenAiTools(tools) } : {}),
        stream: false,
      },
      { timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true }
    );

    if (res.status === 404) {
      throw new Error(
        `${this.model} is not available at ${this.baseUrl}. Run "ollama pull ${this.model}" first, or set LOCAL_MODEL to one you have.`
      );
    }
    if (res.status >= 400) {
      const detail = res.data?.error?.message || res.data?.error || res.statusText;
      throw new Error(`the local model answered ${res.status}: ${detail}`);
    }

    const choice = res.data?.choices?.[0];
    if (!choice) throw new Error("the local model returned no completion");
    return choice.message as ChatMessage;
  }

  async generateText(prompt: string): Promise<string> {
    const message = await this.complete([{ role: "user", content: prompt }]);
    return String(message.content ?? "").trim();
  }

  startChat({ system, history, tools }: StartChatOptions): ChatSession {
    // the whole conversation is resent each turn, which is how this API works.
    // it is held here so a tool round trip can append to it.
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    ];

    // the ids the model gave its calls, needed to answer them in order
    let pendingCallIds: string[] = [];

    const complete = this.complete.bind(this);
    const model = this.model;

    const turn = async (): Promise<ChatReply> => {
      const message = await complete(messages, tools);
      messages.push(message);

      const rawCalls = message.tool_calls || [];
      const calls: ChatReply["calls"] = [];
      pendingCallIds = [];

      for (const call of rawCalls) {
        const args = readArgs(call.function?.arguments);
        if (args === null) {
          // answered rather than dropped silently: leaving a tool_call without
          // a tool message makes the next request malformed, and the model is
          // told what went wrong so it can try again in a readable shape
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              error: `${model} sent arguments that are not valid JSON, so nothing was done. Send them as a JSON object.`,
            }),
          });
          continue;
        }
        pendingCallIds.push(call.id);
        calls.push({ name: call.function.name, args });
      }

      return { text: String(message.content ?? "").trim(), calls };
    };

    return {
      async send(message: string) {
        messages.push({ role: "user", content: message });
        return turn();
      },
      async sendToolResults(results: ToolResult[]) {
        results.forEach((r, i) => {
          messages.push({
            role: "tool",
            tool_call_id: pendingCallIds[i],
            content: JSON.stringify(r.response),
          });
        });
        return turn();
      },
    };
  }

  async health(): Promise<ProviderHealth> {
    const base = { ok: false, provider: this.name, model: this.model };

    try {
      const res = await axios.get(`${this.baseUrl}/models`, {
        timeout: 4000,
        validateStatus: () => true,
      });

      if (res.status >= 400) {
        return { ...base, detail: `${this.baseUrl} answered ${res.status}` };
      }

      // Reported from the list the runtime returns rather than assumed from the
      // fact that something answered. A runtime that is up but has never pulled
      // this model fails at the first real request otherwise.
      const names: string[] = (res.data?.data || []).map((m: any) => String(m.id));
      const has = names.some((n) => n === this.model || n.startsWith(`${this.model}:`));

      if (!has) {
        return {
          ...base,
          detail: `running at ${this.baseUrl}, but ${this.model} is not pulled. Run "ollama pull ${this.model}".`,
        };
      }

      return { ...base, ok: true, detail: `${this.model} ready at ${this.baseUrl}` };
    } catch (err: any) {
      return {
        ...base,
        detail: `nothing is listening at ${this.baseUrl}. Start Ollama, or set LOCAL_MODEL_URL.`,
      };
    }
  }
}
