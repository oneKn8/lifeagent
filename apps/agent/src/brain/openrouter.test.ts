import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ModelCatalog } from "./model-catalog";
import { OpenRouterBrain } from "./openrouter";
import type { ChatChunk } from "./types";

interface ServerHandle {
  baseUrl: string;
  stop: () => Promise<void>;
  requests: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
  setHandler: (handler: (req: Request, body: unknown) => Response | Promise<Response>) => void;
}

function startMock(): ServerHandle {
  const requests: ServerHandle["requests"] = [];
  let handler: (req: Request, body: unknown) => Response | Promise<Response> = () =>
    new Response("not configured", { status: 500 });

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const text = req.method === "POST" ? await req.text() : "";
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // keep raw
      }
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      requests.push({ url: req.url, body, headers });
      return handler(req, body);
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
    requests,
    setHandler: (h) => {
      handler = h;
    },
  };
}

function sse(events: object[]): Response {
  const body = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function makeCatalog(cacheDir: string, modelIds: string[]): Promise<ModelCatalog> {
  const cache = {
    fetchedAt: Date.now(),
    models: modelIds.map((id) => ({
      id,
      name: id,
      contextLength: 4096,
      free: true,
      supportsTools: true,
    })),
  };
  await writeFile(join(cacheDir, "openrouter-models.json"), JSON.stringify(cache));
  return new ModelCatalog({
    apiKey: "test",
    cacheDir,
    baseUrl: "http://unused.invalid",
    ttlMs: 60_000,
  });
}

async function collect(stream: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

describe("OpenRouterBrain", () => {
  let cacheDir: string;
  let server: ServerHandle | null = null;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "lifeagent-openrouter-"));
  });

  afterEach(async () => {
    if (server) await server.stop();
    server = null;
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("streams text response and yields stop", async () => {
    server = startMock();
    server.setHandler(() =>
      sse([
        { choices: [{ index: 0, delta: { content: "Hello" } }] },
        { choices: [{ index: 0, delta: { content: " world" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]),
    );
    const catalog = await makeCatalog(cacheDir, ["model-a/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "key",
      catalog,
      baseUrl: server.baseUrl,
    });

    const chunks = await collect(
      brain.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] }),
    );

    const texts = chunks.filter((c) => c.type === "text").map((c) => c.type === "text" && c.text);
    expect(texts.join("")).toBe("Hello world");
    expect(chunks.at(-1)?.type).toBe("stop");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toContain("/chat/completions");
    const body = server.requests[0]?.body as { model: string; stream: boolean };
    expect(body.model).toBe("model-a/free");
    expect(body.stream).toBe(true);
  });

  it("sends OpenRouter-required headers", async () => {
    server = startMock();
    server.setHandler(() =>
      sse([{ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] }]),
    );
    const catalog = await makeCatalog(cacheDir, ["model-a/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "secret-key",
      catalog,
      baseUrl: server.baseUrl,
      referer: "https://example.test/lifeagent",
      appTitle: "lifeagent-test",
    });

    await collect(brain.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] }));

    const headers = server.requests[0]?.headers ?? {};
    expect(headers.authorization).toBe("Bearer secret-key");
    expect(headers["http-referer"]).toBe("https://example.test/lifeagent");
    expect(headers["x-title"]).toBe("lifeagent-test");
  });

  it("accumulates multi-fragment tool call into a single tool_call chunk", async () => {
    server = startMock();
    server.setHandler(() =>
      sse([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "add_event", arguments: "" },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"title":"' } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'gym"}' } }],
              },
            },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]),
    );
    const catalog = await makeCatalog(cacheDir, ["model-a/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "key",
      catalog,
      baseUrl: server.baseUrl,
    });

    const chunks = await collect(
      brain.chat({ system: "sys", messages: [{ role: "user", content: "schedule gym" }] }),
    );

    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    const tc = toolCalls[0];
    if (tc?.type !== "tool_call") throw new Error("expected tool_call");
    expect(tc.id).toBe("call_1");
    expect(tc.name).toBe("add_event");
    expect(tc.input).toEqual({ title: "gym" });
  });

  it("falls back to next model on 429", async () => {
    server = startMock();
    let callCount = 0;
    server.setHandler((_req, body) => {
      callCount += 1;
      const model = (body as { model: string }).model;
      if (callCount === 1) {
        expect(model).toBe("model-a/free");
        return new Response('{"error":"rate limited"}', {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      expect(model).toBe("model-b/free");
      return sse([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]);
    });
    const catalog = await makeCatalog(cacheDir, ["model-a/free", "model-b/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "key",
      catalog,
      baseUrl: server.baseUrl,
    });

    const chunks = await collect(
      brain.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] }),
    );

    const texts = chunks.filter((c) => c.type === "text").map((c) => c.type === "text" && c.text);
    expect(texts.join("")).toBe("ok");
    expect(callCount).toBe(2);
  });

  it("yields stop with error reason on terminal 401", async () => {
    server = startMock();
    server.setHandler(
      () =>
        new Response('{"error":"unauthorized"}', {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const catalog = await makeCatalog(cacheDir, ["model-a/free", "model-b/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "bad",
      catalog,
      baseUrl: server.baseUrl,
    });

    const chunks = await collect(
      brain.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe("stop");
    if (chunks[0]?.type === "stop") {
      expect(chunks[0].reason).toBe("error");
    }
    expect(server.requests).toHaveLength(1);
  });

  it("respects explicit model override and skips chain", async () => {
    server = startMock();
    server.setHandler((_req, body) => {
      expect((body as { model: string }).model).toBe("explicit/model:free");
      return sse([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]);
    });
    const catalog = await makeCatalog(cacheDir, ["model-a/free", "model-b/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "key",
      catalog,
      baseUrl: server.baseUrl,
    });

    await collect(
      brain.chat({
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        model: "explicit/model:free",
      }),
    );

    expect(server.requests).toHaveLength(1);
  });

  it("parseStructured forces a tool call and returns parsed value", async () => {
    server = startMock();
    server.setHandler((_req, body) => {
      const b = body as {
        tools?: Array<{ function: { name: string; parameters: unknown } }>;
        tool_choice?: unknown;
      };
      expect(b.tools).toBeDefined();
      expect(b.tools?.[0]?.function.name).toBe("respond");
      expect(b.tool_choice).toBeDefined();
      return sse([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "respond",
                      arguments: '{"status":"done","minutes":42}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]);
    });
    const catalog = await makeCatalog(cacheDir, ["model-a/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "key",
      catalog,
      baseUrl: server.baseUrl,
    });

    const schema = z.object({ status: z.string(), minutes: z.number() });
    const result = await brain.parseStructured("Did you finish?", schema);
    expect(result).toEqual({ status: "done", minutes: 42 });
  });

  it("translates Zod tool schemas into JSON Schema in request body", async () => {
    server = startMock();
    server.setHandler((_req, body) => {
      const b = body as {
        tools?: Array<{
          function: {
            name: string;
            parameters: { type?: string; properties?: Record<string, unknown> };
          };
        }>;
      };
      const params = b.tools?.[0]?.function.parameters;
      expect(params?.type).toBe("object");
      expect(params?.properties).toHaveProperty("title");
      return sse([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]);
    });
    const catalog = await makeCatalog(cacheDir, ["model-a/free"]);
    const brain = new OpenRouterBrain({
      apiKey: "key",
      catalog,
      baseUrl: server.baseUrl,
    });

    const schema = z.object({ title: z.string() });
    await collect(
      brain.chat({
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "add_event", description: "create event", inputSchema: schema }],
      }),
    );

    expect(server.requests).toHaveLength(1);
  });
});
