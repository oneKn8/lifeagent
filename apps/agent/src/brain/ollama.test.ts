import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { OllamaBrain } from "./ollama";

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

const NDJSON_TEXT = [
  '{"message":{"role":"assistant","content":"hello "},"done":false}',
  '{"message":{"role":"assistant","content":"world"},"done":false}',
  '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}',
  "",
].join("\n");

const NDJSON_TOOL = [
  '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"send_message","arguments":{"text":"hi"}}}]},"done":false}',
  '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"tool_calls"}',
  "",
].join("\n");

describe("OllamaBrain", () => {
  it("streams ndjson text chunks then stops", async () => {
    const brain = new OllamaBrain({
      fetch: async () =>
        new Response(streamFromString(NDJSON_TEXT), {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        }),
    });
    const out: unknown[] = [];
    for await (const chunk of brain.chat({
      system: "s",
      messages: [{ role: "user", content: "x" }],
    })) {
      out.push(chunk);
    }
    expect(out).toContainEqual({ type: "text", text: "hello " });
    expect(out).toContainEqual({ type: "text", text: "world" });
    expect(out[out.length - 1]).toEqual({ type: "stop", reason: "stop" });
  });

  it("emits tool_call chunks for tool_calls field", async () => {
    const brain = new OllamaBrain({
      fetch: async () =>
        new Response(streamFromString(NDJSON_TOOL), {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        }),
    });
    const out: unknown[] = [];
    for await (const chunk of brain.chat({
      system: "s",
      messages: [{ role: "user", content: "x" }],
    })) {
      out.push(chunk);
    }
    const tc = out.find(
      (c): c is { type: "tool_call"; name: string; input: { text: string } } =>
        (c as { type: string }).type === "tool_call",
    );
    expect(tc?.name).toBe("send_message");
    expect(tc?.input.text).toBe("hi");
  });

  it("parseStructured returns a schema-validated object using format=json", async () => {
    let bodySent: unknown = null;
    const brain = new OllamaBrain({
      fetch: async (_url, init) => {
        bodySent = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ message: { content: '{"status":"done"}' } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const schema = z.object({ status: z.enum(["done", "skipped"]) });
    const out = await brain.parseStructured("any", schema);
    expect(out.status).toBe("done");
    expect((bodySent as { format: string }).format).toBe("json");
  });
});
