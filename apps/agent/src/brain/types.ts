import type { ZodType } from "zod";

export type ChatRole = "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** When `role === "tool"`, the id of the tool call this message is responding to. */
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "stop"; reason: string };

export interface ChatInput {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Brain {
  chat(input: ChatInput): AsyncIterable<ChatChunk>;
  parseStructured<T>(prompt: string, schema: ZodType<T>): Promise<T>;
}
