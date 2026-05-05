import type { ZodType } from "zod";
import type { Brain, ChatChunk, ChatInput, ChatMessage, ToolDefinition } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface AnthropicBrainOptions {
  apiKey: string;
  /** Default model name. */
  defaultModel?: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicBrain implements Brain {
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(opts: AnthropicBrainOptions) {
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
  }

  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    const fetchImpl = this.fetchImpl;
    const baseUrl = this.baseUrl;
    const apiKey = this.apiKey;
    const defaultModel = this.defaultModel;

    return {
      async *[Symbol.asyncIterator]() {
        const body = {
          model: input.model ?? defaultModel,
          system: input.system,
          messages: toAnthropicMessages(input.messages),
          tools: toAnthropicTools(input.tools),
          max_tokens: input.maxTokens ?? 1024,
          temperature: input.temperature ?? 0,
          stream: true,
        };
        const res = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`anthropic chat: ${res.status} ${await res.text()}`);
        }
        if (!res.body) {
          throw new Error("anthropic chat: response had no body");
        }
        const toolBuffers = new Map<number, { id: string; name: string; partial: string }>();
        let stopReason = "end";
        for await (const sse of iterSse(res.body)) {
          if (!sse.event) continue;
          if (sse.event === "content_block_start") {
            const data = JSON.parse(sse.data ?? "{}") as {
              index: number;
              content_block:
                | { type: "text"; text: string }
                | { type: "tool_use"; id: string; name: string; input: unknown };
            };
            if (data.content_block.type === "tool_use") {
              toolBuffers.set(data.index, {
                id: data.content_block.id,
                name: data.content_block.name,
                partial: "",
              });
            }
          } else if (sse.event === "content_block_delta") {
            const data = JSON.parse(sse.data ?? "{}") as {
              index: number;
              delta:
                | { type: "text_delta"; text: string }
                | { type: "input_json_delta"; partial_json: string };
            };
            if (data.delta.type === "text_delta") {
              yield { type: "text", text: data.delta.text };
            } else if (data.delta.type === "input_json_delta") {
              const buf = toolBuffers.get(data.index);
              if (buf) buf.partial += data.delta.partial_json;
            }
          } else if (sse.event === "content_block_stop") {
            const data = JSON.parse(sse.data ?? "{}") as { index: number };
            const buf = toolBuffers.get(data.index);
            if (buf) {
              const parsed = buf.partial.length > 0 ? JSON.parse(buf.partial) : {};
              yield { type: "tool_call", id: buf.id, name: buf.name, input: parsed };
              toolBuffers.delete(data.index);
            }
          } else if (sse.event === "message_delta") {
            const data = JSON.parse(sse.data ?? "{}") as {
              delta: { stop_reason?: string };
            };
            if (data.delta.stop_reason) stopReason = data.delta.stop_reason;
          } else if (sse.event === "message_stop") {
            yield { type: "stop", reason: stopReason };
            return;
          }
        }
        yield { type: "stop", reason: stopReason };
      },
    };
  }

  async parseStructured<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.defaultModel,
        max_tokens: 1024,
        system: "Return JSON only that matches the user's schema. No prose.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`anthropic parseStructured: ${res.status}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    const cleaned = stripFences(text);
    return schema.parse(JSON.parse(cleaned));
  }
}

function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.content,
          },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toAnthropicTools(tools: ToolDefinition[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodLikeToJsonSchema(t.inputSchema),
  }));
}

function zodLikeToJsonSchema(schema: unknown): unknown {
  // Zod v4 schemas expose `.shape`/`.def` but we can't depend on that here without
  // pulling zod into the brain. Treat the schema as opaque and pass an empty
  // object schema; callers can supply pre-converted JSON Schemas via a wrapper.
  if (schema && typeof schema === "object" && (schema as { _def?: unknown })._def) {
    return { type: "object", additionalProperties: true };
  }
  return schema;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    const inner = lines.slice(1, lines.length - 1).join("\n");
    return inner;
  }
  return trimmed;
}

async function* iterSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<{
  event?: string;
  data?: string;
}> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = block.split("\n");
      let event: string | undefined;
      let data: string | undefined;
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          data = (data ? `${data}\n` : "") + line.slice(5).trim();
        }
      }
      if (event || data) yield { event, data };
      idx = buffer.indexOf("\n\n");
    }
  }
}
