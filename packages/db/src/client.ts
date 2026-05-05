import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDbClient(url: string) {
  const sql = postgres(url, { max: 10 });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDbClient>;
