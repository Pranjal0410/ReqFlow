import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import {
  ChatReply,
  ChatSession,
  LlmProvider,
  ProviderHealth,
  StartChatOptions,
  ToolDeclaration,
  ToolResult,
} from "./types";

// The provider ReqFlow shipped with, moved behind the interface without changing
// what it does. Everything here was already in aiChat.ts and gemini.ts; it is
// gathered rather than rewritten, so switching providers cannot quietly change
// the behaviour of the one that already worked.

function toFunctionDeclarations(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([key, p]) => [
          key,
          { type: SchemaType.STRING, description: p.description },
        ])
      ),
      required: t.parameters.required,
    },
  }));
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly local = false;
  readonly model: string;

  private genAI: GoogleGenerativeAI;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateText(prompt: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  }

  startChat({ system, history, tools }: StartChatOptions): ChatSession {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      tools: tools.length
        ? [{ functionDeclarations: toFunctionDeclarations(tools) as any }]
        : undefined,
    });

    // Gemini has no system role in this SDK, so the prompt is the first user
    // turn with an acknowledgement after it. That is how this app has always
    // done it, and it is left alone.
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: system }] },
        {
          role: "model",
          parts: [{ text: "understood. i'm ready to help with API development." }],
        },
        ...history.map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.content }],
        })),
      ],
    });

    const read = (result: any): ChatReply => ({
      // a turn that only calls tools has no text, and asking for it throws
      text: (result.response.functionCalls() || []).length ? "" : result.response.text(),
      calls: (result.response.functionCalls() || []).map((c: any) => ({
        name: c.name,
        args: c.args || {},
      })),
    });

    return {
      async send(message: string) {
        return read(await chat.sendMessage(message));
      },
      async sendToolResults(results: ToolResult[]) {
        const parts = results.map((r) => ({
          functionResponse: { name: r.name, response: r.response },
        }));
        return read(await chat.sendMessage(parts as any));
      },
    };
  }

  async health(): Promise<ProviderHealth> {
    const base = { ok: false, provider: this.name, model: this.model };

    if (!process.env.GEMINI_API_KEY) {
      return { ...base, detail: "GEMINI_API_KEY is not set in backend/.env" };
    }

    try {
      await this.generateText("Reply with the single word: ok");
      return { ...base, ok: true, detail: "reachable" };
    } catch (err: any) {
      return { ...base, detail: String(err?.message || err) };
    }
  }
}
