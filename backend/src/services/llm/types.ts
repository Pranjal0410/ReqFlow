// ReqFlow only ever runs on the developer's own machine, so a cloud model is a
// choice rather than a requirement: nothing here has to work for a remote user.
// That is what makes running the model locally worth the abstraction — no key,
// no quota, no round trip to somebody else's datacentre for a scan of code that
// never leaves the laptop otherwise.
//
// The interface is deliberately small. Two things are asked of a model here:
// produce one block of text from one prompt, and hold a conversation in which it
// may call tools. Everything else the app does is ordinary code.

export interface ToolParameter {
  type: "string";
  description: string;
}

// The neutral shape both providers translate from. It is the intersection of
// what Gemini's function declarations and the OpenAI-compatible tools array can
// express, which is all these five tools have ever needed.
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  name: string;
  response: any;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// One exchange with the model: whatever it said, and whatever it wants called.
// A turn can carry both, and a turn with no calls is the end of the loop.
export interface ChatReply {
  text: string;
  calls: ToolCall[];
}

export interface ChatSession {
  send(message: string): Promise<ChatReply>;
  sendToolResults(results: ToolResult[]): Promise<ChatReply>;
}

export interface StartChatOptions {
  system: string;
  history: ChatTurn[];
  tools: ToolDeclaration[];
  // A provider that drives the tool loop itself calls this instead of handing
  // calls back. Both shapes exist because the libraries differ: a hosted model
  // returns "call this" and waits, while llama.cpp runs the handler and carries
  // on. The caller supplies one function either way, so the difference does not
  // reach the route.
  runTool?: (call: ToolCall) => Promise<any>;
}

// Reported rather than assumed. A local model that is not running looks exactly
// like a cloud key that is wrong until something says which one it is, and the
// answer to "why did nothing happen" should not be a stack trace.
export interface ProviderHealth {
  ok: boolean;
  provider: string;
  model: string;
  detail: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  // true when the work happens on this machine. the UI says so, because "your
  // code was read locally" and "your code was uploaded" are different promises.
  readonly local: boolean;
  // How much prompt this model can take at once, when that is a real limit.
  // A hosted model's window is larger than any project this scans, so it leaves
  // this undefined; a model on a laptop cannot, and the scan batches against it
  // rather than sending a project that will not fit.
  readonly maxPromptChars?: number;
  generateText(prompt: string): Promise<string>;
  // The same prompt, but the answer is required to be JSON of this shape. A
  // provider that can constrain its sampler makes the shape impossible to get
  // wrong; one that cannot falls back to asking and parsing. Callers get an
  // object either way and never have to know which happened.
  generateJson?(prompt: string, schema: object): Promise<any>;
  startChat(options: StartChatOptions): ChatSession;
  health(): Promise<ProviderHealth>;
}
