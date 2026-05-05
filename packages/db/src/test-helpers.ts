import { sql } from "drizzle-orm";
import { type Db, createDbClient } from "./client";

export async function makeTestDb(): Promise<Db> {
  const url = process.env.DATABASE_URL ?? "postgres://lifeagent:lifeagent@localhost:5544/lifeagent";
  const db = createDbClient(url);
  await db.execute(
    sql`TRUNCATE TABLE verification_runs, cron_jobs, integrations, habits, memory_facts, messages, events, users RESTART IDENTITY CASCADE`,
  );
  return db;
}
