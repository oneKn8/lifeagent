import { type Db, createDbClient } from "@lifeagent/db";

let cached: Db | null = null;

/**
 * Process-wide singleton db client. Next.js dev mode hot-reloads, so we cache
 * on globalThis to avoid leaking connections.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const globalCache = globalThis as unknown as { __lifeagent_db?: Db };
  if (globalCache.__lifeagent_db) {
    cached = globalCache.__lifeagent_db;
    return cached;
  }
  const db = createDbClient(url);
  globalCache.__lifeagent_db = db;
  cached = db;
  return db;
}
