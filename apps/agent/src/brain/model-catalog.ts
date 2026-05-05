import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number;
  free: boolean;
  supportsTools: boolean;
}

interface CacheFile {
  fetchedAt: number;
  models: CatalogModel[];
}

export interface ModelCatalogOptions {
  apiKey: string;
  cacheDir: string;
  ttlMs?: number;
  baseUrl?: string;
  referer?: string;
  appTitle?: string;
}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const CACHE_FILENAME = "openrouter-models.json";

export class ModelCatalog {
  private readonly apiKey: string;
  private readonly cacheDir: string;
  private readonly cachePath: string;
  private readonly ttlMs: number;
  private readonly baseUrl: string;
  private readonly referer: string;
  private readonly appTitle: string;
  private cache: CacheFile | null = null;

  constructor(opts: ModelCatalogOptions) {
    this.apiKey = opts.apiKey;
    this.cacheDir = opts.cacheDir;
    this.cachePath = join(opts.cacheDir, CACHE_FILENAME);
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.referer = opts.referer ?? "https://github.com/lifeagent";
    this.appTitle = opts.appTitle ?? "lifeagent";
  }

  async getFreeModels(): Promise<CatalogModel[]> {
    const cache = await this.loadCache();
    if (cache && Date.now() - cache.fetchedAt < this.ttlMs) {
      return cache.models;
    }

    try {
      const fresh = await this.fetchFromApi();
      await this.writeCache(fresh);
      return fresh;
    } catch (err) {
      if (cache) return cache.models;
      throw err;
    }
  }

  async refresh(): Promise<void> {
    const fresh = await this.fetchFromApi();
    await this.writeCache(fresh);
  }

  private async loadCache(): Promise<CacheFile | null> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as CacheFile;
      if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.models)) {
        return null;
      }
      this.cache = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeCache(models: CatalogModel[]): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const data: CacheFile = { fetchedAt: Date.now(), models };
    this.cache = data;
    await writeFile(this.cachePath, JSON.stringify(data, null, 2));
  }

  private async fetchFromApi(): Promise<CatalogModel[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.referer,
        "X-Title": this.appTitle,
      },
    });
    if (!res.ok) {
      throw new Error(`OpenRouter /models failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { data?: RawModel[] };
    const raw = body.data ?? [];
    const free = raw.filter((m) => isFree(m) && hasToolSupport(m));
    free.sort(reliabilityRank);
    return free.map(toCatalogModel);
  }
}

function isFree(m: RawModel): boolean {
  const promptPrice = Number.parseFloat(m.pricing?.prompt ?? "0");
  const completionPrice = Number.parseFloat(m.pricing?.completion ?? "0");
  return promptPrice === 0 && completionPrice === 0;
}

function hasToolSupport(m: RawModel): boolean {
  return (m.supported_parameters ?? []).includes("tools");
}

function toCatalogModel(m: RawModel): CatalogModel {
  return {
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? 0,
    free: true,
    supportsTools: true,
  };
}

const RELIABILITY_PREFIXES = ["meta-llama/", "google/", "deepseek/", "qwen/", "mistralai/"];

function reliabilityRank(a: RawModel, b: RawModel): number {
  return prefixIndex(a.id) - prefixIndex(b.id);
}

function prefixIndex(id: string): number {
  for (let i = 0; i < RELIABILITY_PREFIXES.length; i += 1) {
    if (id.startsWith(RELIABILITY_PREFIXES[i] ?? "")) return i;
  }
  return RELIABILITY_PREFIXES.length;
}
