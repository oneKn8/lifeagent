import { type ZodType, z } from "zod";
import type { ModelCatalog } from "./model-catalog";
import type { Brain, ChatChunk, ChatInput, ChatMessage, ToolDefinition } from "./types";

export interface OpenRouterBrainOptions {
  apiKey: string;
  catalog: ModelCatalog;
  primaryChain?: string[];
  baseUrl?: string;
  referer?: string;
  appTitle?: string;
  primaryChainSize?: number;
}

interface CompletionRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream: true;
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }>;
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
}

interface ToolCallFragment {
  index: number;
  id?: string;
  name?: string;
  argumentsBuf: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REFERER = "https://github.com/lifeagent";
const DEFAULT_APP_TITLE = "lifeagent";
const DEFAULT_CHAIN_SIZE = 5;

export class OpenRouterBrain implements Brain {
  private readonly apiKey: string;
  private readonly catalog: ModelCatalog;
  private readonly explicitChain?: string[];
  private readonly baseUrl: string;
  private readonly referer: string;
  private readonly appTitle: string;
  private readonly chainSize: number;

  constructor(opts: OpenRouterBrainOptions) {
    this.apiKey = opts.apiKey;
    this.catalog = opts.catalog;
    this.explicitChain = opts.primaryChain;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.referer = opts.referer ?? DEFAULT_REFERER;
    this.appTitle = opts.appTitle ?? DEFAULT_APP_TITLE;
    this.chainSize = opts.primaryChainSize ?? DEFAULT_CHAIN_SIZE;
  }

  async *chat(input: ChatInput): AsyncIterable<ChatChunk> {
    const chain = await this.resolveChain(input.model);
    const body = this.buildBody(input);

    let lastErr: Error | null = null;
    for (const model of chain) {
      const attempt = this.streamModel({ ...body, model });
      try {
        for await (const chunk of attempt) {
          yield chunk;
        }
        return;
      } catch (err) {
        const e = err as RetryableError;
        if (!e.retryable) {
          yield { type: "stop", reason: "error" };
          return;
        }
        lastErr = e;
      }
    }

    yield { type: "stop", reason: lastErr ? `error: ${lastErr.message}` : "error: no models" };
  }

  async parseStructured<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema);
    const chain = await this.resolveChain();
    const baseBody: CompletionRequest = {
      model: "",
      messages: [{ role: "user", content: prompt }],
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "respond",
            description: "Respond with the structured answer.",
            parameters: jsonSchema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "respond" } },
    };

    let lastErr: Error | null = null;
    for (const model of chain) {
      try {
        const args = await this.collectFirstToolCallArguments({ ...baseBody, model });
        const parsed = JSON.parse(args);
        return schema.parse(parsed);
      } catch (err) {
        const e = err as RetryableError;
        if (!e.retryable) throw err;
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("no models available for parseStructured");
  }

  private async resolveChain(override?: string): Promise<string[]> {
    if (override) return [override];
    if (this.explicitChain && this.explicitChain.length > 0) return this.explicitChain;
    const free = await this.catalog.getFreeModels();
    if (free.length === 0) throw new Error("OpenRouter catalog returned no free models");
    return free.slice(0, this.chainSize).map((m) => m.id);
  }

  private buildBody(input: ChatInput): Omit<CompletionRequest, "model"> {
    const messages: Array<Record<string, unknown>> = [];
    if (input.system) {
      messages.push({ role: "system", content: input.system });
    }
    for (const m of input.messages) {
      messages.push(toApiMessage(m));
    }
    const body: Omit<CompletionRequest, "model"> = {
      messages,
      stream: true,
    };
    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools.map(toApiTool);
    }
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;
    if (input.temperature !== undefined) body.temperature = input.temperature;
    return body;
  }

  private async *streamModel(body: CompletionRequest): AsyncIterable<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.referer,
        "X-Title": this.appTitle,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new RetryableError(
        `OpenRouter ${body.model} returned ${res.status}`,
        RETRYABLE_STATUS.has(res.status),
      );
    }
    if (!res.body) {
      throw new RetryableError(`OpenRouter ${body.model} returned empty body`, true);
    }

    const fragments = new Map<number, ToolCallFragment>();
    let stopReason = "end";

    for await (const event of parseSse(res.body)) {
      if (event === "[DONE]") break;
      let payload: SsePayload;
      try {
        payload = JSON.parse(event) as SsePayload;
      } catch {
        continue;
      }
      const choice = payload.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        yield { type: "text", text: delta.content };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let frag = fragments.get(idx);
          if (!frag) {
            frag = { index: idx, argumentsBuf: "" };
            fragments.set(idx, frag);
          }
          if (tc.id) frag.id = tc.id;
          if (tc.function?.name) frag.name = tc.function.name;
          if (typeof tc.function?.arguments === "string") {
            frag.argumentsBuf += tc.function.arguments;
          }
        }
      }

      if (choice.finish_reason) {
        stopReason = choice.finish_reason;
      }
    }

    for (const frag of [...fragments.values()].sort((a, b) => a.index - b.index)) {
      let parsed: unknown = {};
      if (frag.argumentsBuf) {
        try {
          parsed = JSON.parse(frag.argumentsBuf);
        } catch {
          parsed = { _raw: frag.argumentsBuf };
        }
      }
      yield {
        type: "tool_call",
        id: frag.id ?? `call_${frag.index}`,
        name: frag.name ?? "",
        input: parsed,
      };
    }

    yield { type: "stop", reason: stopReason };
  }

  private async collectFirstToolCallArguments(body: CompletionRequest): Promise<string> {
    const fragments: ToolCallFragment[] = [];
    for await (const chunk of this.streamModel(body)) {
      if (chunk.type === "tool_call") {
        return JSON.stringify(chunk.input);
      }
    }
    if (fragments.length === 0) {
      throw new Error("no tool call returned");
    }
    return fragments[0]?.argumentsBuf ?? "";
  }
}

class RetryableError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

interface SsePayload {
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
}

function toApiMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return {
      role: "tool",
      content: m.content,
      tool_call_id: m.toolCallId,
    };
  }
  return { role: m.role, content: m.content };
}

function toApiTool(t: ToolDefinition): {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
} {
  const parameters = isZodSchema(t.inputSchema)
    ? z.toJSONSchema(t.inputSchema)
    : (t.inputSchema ?? { type: "object", properties: {} });
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters,
    },
  };
}

function isZodSchema(value: unknown): value is ZodType {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { _def?: unknown; parse?: unknown };
  return typeof candidate.parse === "function" && candidate._def !== undefined;
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = block.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          yield line.slice("data: ".length);
        } else if (line.startsWith("data:")) {
          yield line.slice("data:".length).trimStart();
        }
      }
    }
  }
}
