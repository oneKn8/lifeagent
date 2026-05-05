import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCatalog } from "./model-catalog";

interface ServerHandle {
  baseUrl: string;
  stop: () => Promise<void>;
  requestCount: () => number;
  setResponse: (status: number, body: unknown) => void;
}

function startMockOpenRouter(initial: { status: number; body: unknown }): ServerHandle {
  let response = initial;
  let count = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      count += 1;
      const url = new URL(req.url);
      if (!url.pathname.endsWith("/models")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
    requestCount: () => count,
    setResponse: (status, body) => {
      response = { status, body };
    },
  };
}

const SAMPLE_MODELS = {
  data: [
    {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B (free)",
      context_length: 131072,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools", "tool_choice", "temperature"],
    },
    {
      id: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "tool_choice"],
    },
    {
      id: "google/gemini-2.0-flash-exp:free",
      name: "Gemini 2.0 Flash (free)",
      context_length: 1048576,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools", "tool_choice"],
    },
    {
      id: "deepseek/deepseek-chat:free",
      name: "DeepSeek Chat (free)",
      context_length: 65536,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: [],
    },
  ],
};

describe("ModelCatalog", () => {
  let cacheDir: string;
  let server: ServerHandle | null = null;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "lifeagent-catalog-"));
  });

  afterEach(async () => {
    if (server) await server.stop();
    server = null;
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("fetches free models with tool support and writes cache", async () => {
    server = startMockOpenRouter({ status: 200, body: SAMPLE_MODELS });
    const catalog = new ModelCatalog({
      apiKey: "test-key",
      cacheDir,
      baseUrl: server.baseUrl,
    });
    const models = await catalog.getFreeModels();

    expect(models).toHaveLength(2);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("meta-llama/llama-3.3-70b-instruct:free");
    expect(ids).toContain("google/gemini-2.0-flash-exp:free");
    expect(ids).not.toContain("anthropic/claude-sonnet-4");
    expect(ids).not.toContain("deepseek/deepseek-chat:free");

    for (const m of models) {
      expect(m.free).toBe(true);
      expect(m.supportsTools).toBe(true);
    }

    const cacheFile = join(cacheDir, "openrouter-models.json");
    const cached = JSON.parse(await readFile(cacheFile, "utf8"));
    expect(cached.models).toHaveLength(2);
    expect(typeof cached.fetchedAt).toBe("number");
  });

  it("uses cache on second call when within TTL", async () => {
    server = startMockOpenRouter({ status: 200, body: SAMPLE_MODELS });
    const catalog = new ModelCatalog({
      apiKey: "test-key",
      cacheDir,
      baseUrl: server.baseUrl,
      ttlMs: 60_000,
    });

    await catalog.getFreeModels();
    const firstCount = server.requestCount();
    expect(firstCount).toBe(1);

    await catalog.getFreeModels();
    expect(server.requestCount()).toBe(1);
  });

  it("refetches when cache is stale", async () => {
    server = startMockOpenRouter({ status: 200, body: SAMPLE_MODELS });
    const catalog = new ModelCatalog({
      apiKey: "test-key",
      cacheDir,
      baseUrl: server.baseUrl,
      ttlMs: 1,
    });

    await catalog.getFreeModels();
    expect(server.requestCount()).toBe(1);

    await new Promise((r) => setTimeout(r, 5));
    await catalog.getFreeModels();
    expect(server.requestCount()).toBe(2);
  });

  it("falls back to stale cache when refresh fails", async () => {
    server = startMockOpenRouter({ status: 200, body: SAMPLE_MODELS });
    const catalog = new ModelCatalog({
      apiKey: "test-key",
      cacheDir,
      baseUrl: server.baseUrl,
      ttlMs: 1,
    });
    await catalog.getFreeModels();

    server.setResponse(500, { error: "boom" });
    await new Promise((r) => setTimeout(r, 5));

    const models = await catalog.getFreeModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it("throws when cache is missing and fetch fails", async () => {
    server = startMockOpenRouter({ status: 500, body: { error: "boom" } });
    const catalog = new ModelCatalog({
      apiKey: "test-key",
      cacheDir,
      baseUrl: server.baseUrl,
    });
    await expect(catalog.getFreeModels()).rejects.toThrow();
  });

  it("loads existing cache from disk on construction", async () => {
    const cacheFile = join(cacheDir, "openrouter-models.json");
    await writeFile(
      cacheFile,
      JSON.stringify({
        fetchedAt: Date.now(),
        models: [
          {
            id: "preseeded/model:free",
            name: "Preseeded",
            contextLength: 4096,
            free: true,
            supportsTools: true,
          },
        ],
      }),
    );

    server = startMockOpenRouter({ status: 500, body: {} });
    const catalog = new ModelCatalog({
      apiKey: "test-key",
      cacheDir,
      baseUrl: server.baseUrl,
      ttlMs: 60_000,
    });
    const models = await catalog.getFreeModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("preseeded/model:free");
    expect(server.requestCount()).toBe(0);
  });
});
