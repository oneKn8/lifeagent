import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDbClient } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const db = createDbClient(url);
await migrate(db, { migrationsFolder: "./migrations" });
console.log("migrated");
process.exit(0);
