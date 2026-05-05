import type { ZodType } from "zod";
import type { Brain, ChatChunk, ChatInput, ChatMessage, ToolDefinition } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OllamaBrainOptions {
  baseUrl?: string;
  defaultModel?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.1";

export class OllamaBrain implements Brain {
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: OllamaBrainOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    const fetchImpl = this.fetchImpl;
    const baseUrl = this.baseUrl;
    const defaultModel = this.defaultModel;

    return {
      async *[Symbol.asyncIterator]() {
        const body = {
          model: input.model ?? defaultModel,
          messages: toOllamaMessages(input.system, input.messages),
          tools: toOllamaTools(input.tools),
          options: {
            temperature: input.temperature ?? 0,
          },
          stream: true,
        };
        const res = await fetchImpl(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`ollama chat: ${res.status}`);
        }
        if (!res.body) throw new Error("ollama chat: no body");
        let stopReason = "end";
        for await (const obj of iterNdjson(res.body)) {
          const chunk = obj as {
            message?: {
              content?: string;
              tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
            };
            done?: boolean;
            done_reason?: string;
          };
          const content = chunk.message?.content;
          if (content && content.length > 0) {
            yield { type: "text", text: content };
          }
          const toolCalls = chunk.message?.tool_calls;
          if (toolCalls && toolCalls.length > 0) {
            for (let i = 0; i < toolCalls.length; i += 1) {
              const tc = toolCalls[i];
              if (!tc) continue;
              yield {
                type: "tool_call",
                id: `tc_${Date.now()}_${i}`,
                name: tc.function.name,
                input: tc.function.arguments,
              };
            }
          }
          if (chunk.done) {
            stopReason = chunk.done_reason ?? "end";
            break;
          }
        }
        yield { type: "stop", reason: stopReason };
      },
    };
  }

  async parseStructured<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.defaultModel,
        format: "json",
        messages: [
          { role: "system", content: "Return JSON only." },
          { role: "user", content: prompt },
        ],
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`ollama parseStructured: ${res.status}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content ?? "";
    return schema.parse(JSON.parse(text));
  }
}

function toOllamaMessages(system: string, messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

function toOllamaTools(tools: ToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", additionalProperties: true },
    },
  }));
}

async function* iterNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          yield JSON.parse(line);
        } catch {
          // skip malformed lines
        }
      }
      idx = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim());
    } catch {
      // skip
    }
  }
}
