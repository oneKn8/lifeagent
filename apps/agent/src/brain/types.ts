/**
 * Shared brain types. Phase 4 will provide the concrete brain implementation;
 * Phase 3 only depends on these interfaces so the loop and SDK can be tested
 * with mocks.
 */

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
}

export interface Brain {
  chat(input: ChatInput): AsyncIterable<ChatChunk>;
}
