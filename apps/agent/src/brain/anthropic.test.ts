import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { AnthropicBrain } from "./anthropic";

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

function sseResponse(events: string): Response {
  return new Response(streamFromString(events), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const STREAM_TEXT = [
  "event: message_start",
  'data: {"type":"message_start","message":{}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello "}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

const STREAM_TOOL = [
  "event: message_start",
  'data: {"type":"message_start","message":{}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"send_message","input":{}}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"text\\":\\"hi\\"}"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

describe("AnthropicBrain", () => {
  it("streams text deltas as text chunks and ends with stop", async () => {
    const brain = new AnthropicBrain({
      apiKey: "k",
      fetch: async () => sseResponse(STREAM_TEXT),
    });
    const out: unknown[] = [];
    for await (const chunk of brain.chat({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    })) {
      out.push(chunk);
    }
    expect(out).toContainEqual({ type: "text", text: "hello " });
    expect(out).toContainEqual({ type: "text", text: "world" });
    expect(out[out.length - 1]).toEqual({ type: "stop", reason: "end_turn" });
  });

  it("emits a tool_call chunk for tool_use blocks with parsed input", async () => {
    const brain = new AnthropicBrain({
      apiKey: "k",
      fetch: async () => sseResponse(STREAM_TOOL),
    });
    const out: unknown[] = [];
    for await (const chunk of brain.chat({
      system: "s",
      messages: [{ role: "user", content: "x" }],
    })) {
      out.push(chunk);
    }
    const toolCall = out.find(
      (c): c is { type: "tool_call"; id: string; name: string; input: { text: string } } =>
        (c as { type: string }).type === "tool_call",
    );
    expect(toolCall?.name).toBe("send_message");
    expect(toolCall?.input.text).toBe("hi");
  });

  it("parseStructured returns a schema-validated object from JSON-only response", async () => {
    const brain = new AnthropicBrain({
      apiKey: "k",
      fetch: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: '{"status":"done"}' }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const schema = z.object({ status: z.enum(["done", "skipped"]) });
    const out = await brain.parseStructured("any", schema);
    expect(out.status).toBe("done");
  });
});
