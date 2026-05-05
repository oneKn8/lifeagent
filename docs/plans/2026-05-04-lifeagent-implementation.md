# lifeagent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build lifeagent v1 — a Bun/TypeScript runtime with Telegram bot, activity-verified accountability (Strava/GitHub/Wakatime), Postgres state, web dashboard, and 5 markdown skills, shippable as a one-command `docker compose up` self-host.

**Architecture:** Monorepo with two apps (`agent` Bun service, `web` Next.js app) and two shared packages (`db`, `types`). Runtime is custom and minimal (~800 LoC) implementing tool registry, cron scheduler, skill loader, memory store, hooks. Brain is provider-swappable (Anthropic primary, OpenAI + Ollama adapters). Verifiers cross-reference user replies against real activity APIs.

**Tech Stack:** Bun, TypeScript, Next.js 15, Tailwind v4, shadcn/ui, Drizzle ORM, Postgres, grammY, Anthropic SDK, OpenAI SDK, Zod, vitest.

---

## Phase Map

| Phase | Outcome | Depends on |
|---|---|---|
| 0 | Repo scaffold, workspace, configs, DB up | — |
| 1 | DB schema, migrations, Drizzle queries | 0 |
| 2 | Runtime: tool registry + skill loader + memory + hooks | 1 |
| 3 | Runtime: cron scheduler + agent loop + SDK | 2 |
| 4 | Brain: Anthropic adapter + provider interface | 2 |
| 5 | Telegram bot v0 — receive + reply, no agent loop wired | 0 |
| 6 | Skills (5 markdown files) wired to brain | 4, 2 |
| 7 | Manual source adapter — events from chat | 3, 5, 6 |
| 8 | Pre/post-ping logic + nightly summary cron | 7 |
| 9 | Verifiers: Strava + GitHub + Wakatime + verifier interface | 7 |
| 10 | Confrontation logic (verifier contradicts → agent calls out) | 9, 6 |
| 11 | Telegram escalation ladder (T+5/T+15/T+30) | 8 |
| 12 | Gcal source adapter | 7 |
| 13 | CLI (`lifeagent start | plan | status | inbox | replay | verify-now`) | 3 |
| 14 | Web dashboard scaffold + auth (Telegram Login Widget) | 1 |
| 15 | Web dashboard pages (timeline, history, memory, settings) | 14 |
| 16 | OpenAI + Ollama brain adapters | 4 |
| 17 | Docker compose, Dockerfiles, README, demo gif | all |

Total estimated tasks: ~110. Each phase ends with all tests passing + a green commit.

---

## Conventions

- **Test framework:** vitest (Bun-native, fast). Tests live next to code as `<file>.test.ts`.
- **Type safety:** strict mode on. Zod schemas at all boundaries (DB rows, channel inputs, LLM tool calls).
- **Commits:** every passing task ends with a commit. Conventional commits (feat/fix/refactor/test/chore/docs).
- **Code style:** Biome (formatter + linter) configured in Phase 0. Run `bun run lint` before each commit.
- **No comments unless WHY is non-obvious.** Code documents WHAT.
- **DRY** ruthlessly. **YAGNI** — if it's not on the v1 IN list in the design doc, it doesn't go in.

---

## Phase 0 — Scaffold

### Task 0.1 — Initialize Bun workspace

**Files:**
- Create: `package.json`
- Create: `bunfig.toml`
- Create: `tsconfig.json`
- Create: `biome.json`

**Steps:**

1. **Init root package.json as workspace**
   ```bash
   cd /home/oneknight/projects/lifeagent
   bun init -y
   ```
   Edit the resulting `package.json` to:
   ```json
   {
     "name": "lifeagent",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "workspaces": ["apps/*", "packages/*"],
     "scripts": {
       "dev": "bun --filter '*' dev",
       "build": "bun --filter '*' build",
       "test": "bun --filter '*' test",
       "lint": "biome check .",
       "format": "biome format --write ."
     },
     "devDependencies": {
       "@biomejs/biome": "^1.9.4",
       "typescript": "^5.7.2"
     }
   }
   ```

2. **Add `tsconfig.json` (root, strict)**
   ```json
   {
     "compilerOptions": {
       "target": "ES2023",
       "lib": ["ES2023"],
       "module": "ESNext",
       "moduleResolution": "bundler",
       "strict": true,
       "noUnusedLocals": true,
       "noUnusedParameters": true,
       "noFallthroughCasesInSwitch": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "isolatedModules": true,
       "verbatimModuleSyntax": true
     }
   }
   ```

3. **Add `biome.json`**
   ```json
   {
     "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
     "organizeImports": { "enabled": true },
     "linter": {
       "enabled": true,
       "rules": {
         "recommended": true,
         "style": { "noNonNullAssertion": "warn" }
       }
     },
     "formatter": {
       "enabled": true,
       "indentStyle": "space",
       "indentWidth": 2,
       "lineWidth": 100
     }
   }
   ```

4. **Verify**
   ```bash
   bun install
   bun run lint
   ```
   Expected: lint passes (nothing to lint yet).

5. **Commit**
   ```bash
   git add package.json bunfig.toml tsconfig.json biome.json
   git commit -m "chore: initialize Bun workspace with TS strict and Biome"
   ```

### Task 0.2 — Create app/package skeletons

**Files:**
- Create: `apps/agent/package.json`, `apps/agent/tsconfig.json`, `apps/agent/src/index.ts`
- Create: `apps/web/package.json` (Next.js scaffold deferred to Phase 14)
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts`
- Create: `packages/types/package.json`, `packages/types/src/index.ts`

**Steps:**

1. **`apps/agent/package.json`**
   ```json
   {
     "name": "@lifeagent/agent",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "bun --watch src/index.ts",
       "build": "bun build src/index.ts --target=bun --outdir=dist",
       "test": "bun test"
     },
     "dependencies": {
       "@lifeagent/db": "workspace:*",
       "@lifeagent/types": "workspace:*"
     }
   }
   ```

2. **`apps/agent/src/index.ts`**
   ```ts
   console.log("lifeagent agent starting...");
   ```

3. **`packages/db/package.json`**
   ```json
   {
     "name": "@lifeagent/db",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "main": "./src/index.ts",
     "types": "./src/index.ts"
   }
   ```

4. **`packages/db/src/index.ts`**
   ```ts
   export {};
   ```

5. **`packages/types/package.json`** — same shape as `db`.

6. **`packages/types/src/index.ts`**
   ```ts
   export {};
   ```

7. **Verify**
   ```bash
   bun install
   bun run apps/agent/src/index.ts
   ```
   Expected: prints "lifeagent agent starting..."

8. **Commit**
   ```bash
   git add apps packages
   git commit -m "chore: add agent app and db/types package skeletons"
   ```

### Task 0.3 — Postgres dev compose + .env

**Files:**
- Create: `docker-compose.dev.yml`
- Create: `.env.example`
- Modify: `.gitignore` (already has `.env` — verify)

**Steps:**

1. **`docker-compose.dev.yml`**
   ```yaml
   services:
     postgres:
       image: postgres:17-alpine
       restart: unless-stopped
       environment:
         POSTGRES_USER: lifeagent
         POSTGRES_PASSWORD: lifeagent
         POSTGRES_DB: lifeagent
       ports:
         - "5433:5432"
       volumes:
         - lifeagent_pg:/var/lib/postgresql/data
   volumes:
     lifeagent_pg:
   ```

2. **`.env.example`**
   ```
   DATABASE_URL=postgres://lifeagent:lifeagent@localhost:5433/lifeagent
   TELEGRAM_BOT_TOKEN=
   OWNER_TELEGRAM_ID=
   ANTHROPIC_API_KEY=
   OPENAI_API_KEY=
   OLLAMA_BASE_URL=http://localhost:11434
   STRAVA_CLIENT_ID=
   STRAVA_CLIENT_SECRET=
   GITHUB_PAT=
   WAKATIME_API_KEY=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   ENCRYPTION_KEY=  # 32 bytes base64 for AES-GCM, generate with `openssl rand -base64 32`
   ```

3. **Bring up Postgres**
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   docker compose -f docker-compose.dev.yml ps
   ```
   Expected: postgres healthy on `localhost:5433`.

4. **Smoke-test connection**
   ```bash
   docker compose -f docker-compose.dev.yml exec postgres psql -U lifeagent -d lifeagent -c "SELECT 1;"
   ```
   Expected: returns `1`.

5. **Commit**
   ```bash
   git add docker-compose.dev.yml .env.example
   git commit -m "chore: add Postgres dev compose and env template"
   ```

---

## Phase 1 — Database schema + Drizzle

### Task 1.1 — Add Drizzle deps + config

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/drizzle.config.ts`

**Steps:**

1. **Add deps**
   ```bash
   cd packages/db
   bun add drizzle-orm postgres
   bun add -d drizzle-kit @types/node
   cd -
   ```

2. **`packages/db/drizzle.config.ts`**
   ```ts
   import type { Config } from "drizzle-kit";
   export default {
     schema: "./src/schema.ts",
     out: "./migrations",
     dialect: "postgresql",
     dbCredentials: {
       url: process.env.DATABASE_URL ?? "postgres://lifeagent:lifeagent@localhost:5433/lifeagent",
     },
   } satisfies Config;
   ```

3. **Update `packages/db/package.json` scripts**
   ```json
   "scripts": {
     "generate": "drizzle-kit generate",
     "migrate": "bun src/migrate.ts",
     "studio": "drizzle-kit studio"
   }
   ```

4. **Commit**
   ```bash
   git add packages/db
   git commit -m "chore(db): add drizzle-orm and drizzle-kit"
   ```

### Task 1.2 — Define schema (all v1 tables)

**Files:**
- Create: `packages/db/src/schema.ts`

**Steps:**

1. **Write `packages/db/src/schema.ts` covering all tables from the design doc**
   - `users`, `events`, `messages`, `memory_facts`, `habits`, `integrations`, `cron_jobs`, `verification_runs`
   - Use enums for status fields (`event_status`, `verification_status`, `cron_kind`, etc.)
   - Use `pgTable`, `serial`/`uuid`, `timestamp`, `jsonb`, `text`, `boolean`, `numeric`
   - Define typed inserts/selects with `$inferInsert`/`$inferSelect`

   Concrete starting point (full schema follows the design doc §6):
   ```ts
   import { pgTable, uuid, text, timestamp, jsonb, integer, boolean, pgEnum } from "drizzle-orm/pg-core";

   export const eventStatus = pgEnum("event_status", [
     "planned", "in_progress", "done", "skipped", "slipped", "blocked",
   ]);

   export const verificationStatus = pgEnum("verification_status", [
     "pending", "consistent", "contradicted", "inconclusive",
   ]);

   export const cronKind = pgEnum("cron_kind", [
     "pre_ping", "post_ping", "morning_brief", "nightly_summary", "verify",
   ]);

   export const users = pgTable("users", {
     id: uuid("id").primaryKey().defaultRandom(),
     telegramId: text("telegram_id").unique(),
     email: text("email"),
     tz: text("tz").notNull().default("America/Chicago"),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
   });

   export const events = pgTable("events", {
     id: uuid("id").primaryKey().defaultRandom(),
     userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
     source: text("source").notNull(),
     externalId: text("external_id"),
     title: text("title").notNull(),
     startAt: timestamp("start_at", { withTimezone: true }).notNull(),
     endAt: timestamp("end_at", { withTimezone: true }).notNull(),
     status: eventStatus("status").notNull().default("planned"),
     prePingAt: timestamp("pre_ping_at", { withTimezone: true }),
     prePingSentAt: timestamp("pre_ping_sent_at", { withTimezone: true }),
     postPingAt: timestamp("post_ping_at", { withTimezone: true }),
     postPingSentAt: timestamp("post_ping_sent_at", { withTimezone: true }),
     userReplyText: text("user_reply_text"),
     parsedState: jsonb("parsed_state"),
     verificationStatus: verificationStatus("verification_status").notNull().default("pending"),
     notes: text("notes"),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
   });

   // ... (messages, memory_facts, habits, integrations, cron_jobs, verification_runs)
   ```

2. **Generate migration**
   ```bash
   cd packages/db
   bun run generate
   ```
   Expected: creates `packages/db/migrations/0000_<name>.sql`.

3. **Commit**
   ```bash
   git add packages/db/src/schema.ts packages/db/migrations
   git commit -m "feat(db): define v1 schema with all tables and enums"
   ```

### Task 1.3 — Migration runner + connection helper

**Files:**
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/index.ts` (export surface)

**Steps:**

1. **`packages/db/src/client.ts`**
   ```ts
   import { drizzle } from "drizzle-orm/postgres-js";
   import postgres from "postgres";
   import * as schema from "./schema";

   export function createDbClient(url: string) {
     const sql = postgres(url, { max: 10 });
     return drizzle(sql, { schema });
   }

   export type Db = ReturnType<typeof createDbClient>;
   ```

2. **`packages/db/src/migrate.ts`**
   ```ts
   import { migrate } from "drizzle-orm/postgres-js/migrator";
   import { createDbClient } from "./client";

   const url = process.env.DATABASE_URL;
   if (!url) throw new Error("DATABASE_URL required");
   const db = createDbClient(url);
   await migrate(db, { migrationsFolder: "./migrations" });
   console.log("migrated");
   process.exit(0);
   ```

3. **`packages/db/src/index.ts`**
   ```ts
   export * as schema from "./schema";
   export { createDbClient, type Db } from "./client";
   ```

4. **Run migration**
   ```bash
   cd packages/db
   DATABASE_URL=postgres://lifeagent:lifeagent@localhost:5433/lifeagent bun run migrate
   ```
   Expected: prints `migrated`.

5. **Verify in psql**
   ```bash
   docker compose -f ../../docker-compose.dev.yml exec postgres psql -U lifeagent -d lifeagent -c "\dt"
   ```
   Expected: lists `users`, `events`, `messages`, etc.

6. **Commit**
   ```bash
   git add packages/db
   git commit -m "feat(db): migration runner and connection helper"
   ```

### Task 1.4 — Query helpers + tests

**Files:**
- Create: `packages/db/src/queries/events.ts`
- Create: `packages/db/src/queries/events.test.ts`
- Create: `packages/db/src/queries/messages.ts`
- (and queries for memory_facts, integrations, cron_jobs, verification_runs)

**Steps per file (TDD pattern):**

1. **Write failing test for `getEventsForDay(userId, day)`**
   ```ts
   import { describe, it, expect, beforeAll } from "vitest";
   // setup test db, seed user + 2 events on 2026-05-04, 1 event on 2026-05-05
   it("returns only events on the requested day", async () => {
     const result = await getEventsForDay(db, userId, new Date("2026-05-04"));
     expect(result).toHaveLength(2);
   });
   ```

2. **Run test → fail.**

3. **Implement `getEventsForDay`** using Drizzle:
   ```ts
   import { and, gte, lt, eq } from "drizzle-orm";
   import { events } from "../schema";

   export async function getEventsForDay(db: Db, userId: string, day: Date) {
     const start = new Date(day); start.setUTCHours(0, 0, 0, 0);
     const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
     return db.select().from(events).where(
       and(eq(events.userId, userId), gte(events.startAt, start), lt(events.startAt, end))
     );
   }
   ```

4. **Run test → pass.**

5. **Repeat for:** `createEvent`, `updateEventStatus`, `getEventById`, `getUpcomingEventsNeedingPings`, `appendMessage`, `recentMessages`, `addMemoryFact`, `topMemoryFacts`, `upsertIntegration`, `getIntegration`, `createCronJob`, `getDueCronJobs`, `markCronJobRan`, `recordVerificationRun`, `getVerificationsForEvent`.

6. **Commit after each query+test passes:** `feat(db): <query name> with test`

---

## Phase 2 — Runtime: tools, skills, memory, hooks

### Task 2.1 — Tool registry + types

**Files:**
- Create: `apps/agent/src/runtime/tools.ts`
- Create: `apps/agent/src/runtime/tools.test.ts`

**Steps:**

1. **TDD: failing test**
   ```ts
   import { describe, it, expect } from "vitest";
   import { z } from "zod";
   import { ToolRegistry } from "./tools";

   it("registers and dispatches a tool", async () => {
     const r = new ToolRegistry();
     r.register({
       name: "echo",
       description: "echo input",
       inputSchema: z.object({ msg: z.string() }),
       async run({ input }) { return { echoed: input.msg }; },
     });
     const result = await r.dispatch("echo", { msg: "hi" });
     expect(result).toEqual({ echoed: "hi" });
   });

   it("throws on unknown tool", async () => {
     const r = new ToolRegistry();
     await expect(r.dispatch("nope", {})).rejects.toThrow();
   });

   it("validates input with zod", async () => {
     // ... assert validation error on bad input
   });
   ```

2. **Run → fail.**

3. **Implement**
   ```ts
   import type { z } from "zod";

   export interface Tool<I = unknown, O = unknown> {
     name: string;
     description: string;
     inputSchema: z.ZodType<I>;
     run(ctx: { input: I; userId: string; eventId?: string }): Promise<O>;
   }

   export class ToolRegistry {
     private tools = new Map<string, Tool>();
     register(t: Tool) {
       if (this.tools.has(t.name)) throw new Error(`tool ${t.name} already registered`);
       this.tools.set(t.name, t);
     }
     get(name: string) { return this.tools.get(name); }
     list() { return [...this.tools.values()]; }
     async dispatch(name: string, input: unknown, ctx: { userId: string; eventId?: string } = { userId: "" }) {
       const t = this.tools.get(name);
       if (!t) throw new Error(`tool ${name} not registered`);
       const validated = t.inputSchema.parse(input);
       return t.run({ input: validated, ...ctx });
     }
   }
   ```

4. **Run → pass.**

5. **Commit:** `feat(runtime): tool registry with zod-validated dispatch`

### Task 2.2 — Skill loader (markdown + YAML frontmatter, hot reload)

**Files:**
- Create: `apps/agent/src/runtime/skills.ts`
- Create: `apps/agent/src/runtime/skills.test.ts`
- Create: `apps/agent/src/skills/.gitkeep`

**Steps:**

1. **TDD: load skill from a fixture markdown**
   - Test setup: write a temp `.md` file with frontmatter + body
   - Assert `SkillLoader.load(path)` returns parsed `{ name, description, type, body }`
   - Test hot-reload: modify the file, expect the loader to surface new content

2. **Implement `SkillLoader`** using `gray-matter` for frontmatter and `node:fs/promises` watch for hot-reload.
   ```bash
   cd apps/agent && bun add gray-matter
   ```

3. **Add a starter skill `apps/agent/src/skills/lifeagent.md`** (full content in Phase 6).

4. **Commit:** `feat(runtime): markdown skill loader with hot reload`

### Task 2.3 — Memory store (typed wrapper around DB queries)

**Files:**
- Create: `apps/agent/src/runtime/memory.ts`
- Create: `apps/agent/src/runtime/memory.test.ts`

**Steps:**

1. **TDD:** test `MemoryStore.addFact()`, `recall(query)` (LIKE-based for v1), `topRecent(n)`.
2. **Implement** using `@lifeagent/db` query helpers from Task 1.4.
3. **Commit:** `feat(runtime): memory store with LIKE-based recall`

### Task 2.4 — Hook bus

**Files:**
- Create: `apps/agent/src/runtime/hooks.ts`
- Create: `apps/agent/src/runtime/hooks.test.ts`

**Steps:**

1. **TDD:** test `register('pre_tool', fn)`, `emit('pre_tool', payload)` invokes registered handlers in order; throwing handler aborts the emit chain when `mode: 'cancellable'`.
2. **Implement** simple typed event emitter with cancellable mode.
3. **Commit:** `feat(runtime): hook bus with cancellable mode`

---

## Phase 3 — Runtime: cron, loop, SDK

### Task 3.1 — Cron scheduler (persistent)

**Files:**
- Create: `apps/agent/src/runtime/cron.ts`
- Create: `apps/agent/src/runtime/cron.test.ts`

**Steps:**

1. **Add deps**
   ```bash
   cd apps/agent && bun add node-cron
   bun add -d @types/node-cron
   ```

2. **TDD:**
   - `CronScheduler.schedule({ kind, schedule, payload })` writes a row to `cron_jobs`
   - `start()` registers handlers from DB, fires `pre_cron_fire` hook
   - On fire: invokes a handler keyed by `kind`, updates `last_run_at`, computes `next_run_at`
   - On error: increments `retry_count`, schedules retry with exponential backoff (60s, 120s, 300s)
   - `delete(id)` removes row + cancels active task

3. **Implement** using `node-cron` for in-process scheduling + DB rows as source of truth across restarts.

4. **Commit:** `feat(runtime): persistent cron scheduler with retries`

### Task 3.2 — Agent loop

**Files:**
- Create: `apps/agent/src/runtime/loop.ts`
- Create: `apps/agent/src/runtime/loop.test.ts`

**Steps:**

1. **TDD with mock brain:**
   - Loop receives a message → calls brain → if brain returns tool calls, executes them → feeds results back → repeats until brain returns final text or budget exceeded
   - Each tool call goes through hooks (`pre_tool`, `post_tool`)
   - Budget: max 10 iterations, max 30s wall time
   - Returns `{ finalText, toolCalls, durationMs, iterations }`

2. **Implement.** Use a simple state machine: `await brain.chat()`, parse for tool requests, dispatch via `ToolRegistry`, push results into next turn.

3. **Commit:** `feat(runtime): agent loop with budget and hooks`

### Task 3.3 — SDK (programmatic API)

**Files:**
- Create: `apps/agent/src/runtime/sdk.ts`
- Create: `apps/agent/src/runtime/sdk.test.ts`

**Steps:**

1. **Define the `LifeAgentSDK` class**
   - `constructor({ db, brain, telegram, ... })`
   - `submitUserMessage(userId, channel, text)` → runs the agent loop, persists messages
   - `runCron(jobId)` → fires a specific cron job manually (used by tests + CLI)
   - `getDayPlan(userId, day)` → reads events
   - `addManualEvent(userId, { title, startAt, endAt })` → creates event + schedules pre/post pings

2. **TDD:** integration-ish test with in-memory mocks for brain/telegram.

3. **Commit:** `feat(runtime): SDK exposing programmatic API`

---

## Phase 4 — Brain: provider interface + Anthropic adapter

### Task 4.1 — Brain interface

**Files:**
- Create: `apps/agent/src/brain/types.ts`
- Create: `apps/agent/src/brain/index.ts`

**Steps:**

1. **Define types**
   ```ts
   export interface ChatInput {
     system: string;
     messages: Array<{ role: "user" | "assistant" | "tool"; content: string; toolCallId?: string }>;
     tools?: Array<{ name: string; description: string; inputSchema: unknown }>;
     model?: string;
     maxTokens?: number;
   }
   export type ChatChunk =
     | { type: "text"; text: string }
     | { type: "tool_call"; id: string; name: string; input: unknown }
     | { type: "stop"; reason: string };
   export interface Brain {
     chat(input: ChatInput): AsyncIterable<ChatChunk>;
     parseStructured<T>(prompt: string, schema: import("zod").ZodType<T>): Promise<T>;
   }
   ```

2. **Commit:** `feat(brain): provider interface and chunk types`

### Task 4.2 — Anthropic adapter

**Files:**
- Create: `apps/agent/src/brain/anthropic.ts`
- Create: `apps/agent/src/brain/anthropic.test.ts`

**Steps:**

1. **Add SDK** `cd apps/agent && bun add @anthropic-ai/sdk`
2. **TDD with mock client:**
   - `chat()` yields text chunks for an Anthropic streaming response
   - Tool calls are emitted as `tool_call` chunks with parsed JSON input
   - `parseStructured` uses tool-use to coerce a Zod schema response
3. **Implement.** Map the Anthropic stream events (`message_delta`, `content_block_delta`, `tool_use`) into our chunk type.
4. **Commit:** `feat(brain): Anthropic adapter with streaming + tool use`

---

## Phase 5 — Telegram bot v0

### Task 5.1 — Telegram adapter scaffold

**Files:**
- Create: `apps/agent/src/adapters/telegram.ts`
- Create: `apps/agent/src/adapters/telegram.test.ts`

**Steps:**

1. **Add deps** `cd apps/agent && bun add grammy`
2. **TDD with grammy testing utilities:**
   - Bot starts on long-poll mode
   - On `/start`: replies "lifeagent online"
   - On `/whoami`: replies with chat id
   - On any other message: routes to a handler injected at construction time

3. **Implement** `class TelegramAdapter { constructor({ token, ownerId, onMessage }) }`. Whitelist via `ownerId`.

4. **Commit:** `feat(telegram): grammY adapter with whitelist and message routing`

### Task 5.2 — Outbound message tools

**Files:**
- Create: `apps/agent/src/runtime/tools/send_message.ts`
- Create: `apps/agent/src/runtime/tools/send_voice_note.ts`
- Create: `apps/agent/src/runtime/tools/send_message.test.ts`

**Steps:**

1. **Tool: `send_message`** — input `{ text }`. Writes to `messages` table + sends via Telegram adapter.
2. **Tool: `send_voice_note`** — input `{ text }`. Generate TTS via the brain provider's audio API (Anthropic doesn't have one; use OpenAI TTS as a stopgap behind a feature flag, OR use a simple text fallback for v1).
3. **TDD** each tool dispatches correctly.
4. **Commit:** `feat(tools): outbound Telegram message tools`

---

## Phase 6 — Skills (markdown)

### Task 6.1 — Write `lifeagent.md`

**File:** `apps/agent/src/skills/lifeagent.md`

**Steps:**

1. **Write skill body**
   ```md
   ---
   name: lifeagent
   description: Main planner and accountability persona
   type: persona
   triggers: [chat, pre_ping, post_ping, replan, summary]
   ---
   You are lifeagent — the user's accountability bot. Your job is to help them follow through on what they planned to do.

   ## Tone
   - Direct, no fluff. Not aggressive, not coddling.
   - You call out contradictions when verifiers say something different from what the user reported.
   - You don't moralize. You note the fact and ask what they want to do.

   ## Behavior
   - Before each event, send a brief pre-ping with the title and what the user said about it.
   - After each event, send a post-ping asking for status: started, partial, done, skipped, slipped.
   - If a verifier returns `consistent: false` with confidence > 0.7, confront with the evidence.
   - On slip: ask if they want to reschedule downstream events; propose a concrete shift.

   ## Tools
   You have access to tools for:
   - reading and writing events
   - logging memory facts about the user
   - querying memory
   - sending messages and voice notes
   - querying verifiers

   ## Hard rules
   - Never confront unless a `verification_run.id` is referenced in your context.
   - Never auto-reschedule without proposing first and getting a yes.
   - Stay under 4 sentences in pre/post pings unless the user asks for more.
   ```

2. **Commit:** `feat(skills): main lifeagent persona`

### Task 6.2 — Write `daily-brief.md`, `daily-summary.md`, `reschedule.md`, `memory-extractor.md`

Each follows the same shape: frontmatter + role-specific instructions. Keep each under 80 lines.

Commit each separately:
- `feat(skills): morning brief generator`
- `feat(skills): nightly summary generator`
- `feat(skills): reschedule prompt`
- `feat(skills): memory extractor`

---

## Phase 7 — Manual source adapter

### Task 7.1 — Source adapter interface

**Files:**
- Create: `apps/agent/src/adapters/source.ts`
- Create: `apps/agent/src/adapters/source.test.ts`

**Steps:**

1. **Define `SourceAdapter` interface** per design doc §5.4
2. **Stub `ManualAdapter`** that uses DB directly
3. **Commit:** `feat(adapters): source adapter interface and manual stub`

### Task 7.2 — `add_event` tool

**Files:**
- Create: `apps/agent/src/runtime/tools/add_event.ts`
- Create: `apps/agent/src/runtime/tools/add_event.test.ts`

**Steps:**

1. **TDD:** tool input `{ title, startAt, endAt, source }`. Creates event row, schedules pre-ping cron at `startAt - 5min` and post-ping cron at `endAt`.
2. **Implement** using `LifeAgentSDK.addManualEvent`.
3. **Commit:** `feat(tools): add_event with auto-scheduled pings`

### Task 7.3 — `update_event` and `mark_event_status` tools

Similar TDD pattern.

Commit per tool.

---

## Phase 8 — Pre/post pings + nightly summary

### Task 8.1 — Pre-ping handler

**Files:**
- Create: `apps/agent/src/runtime/handlers/pre_ping.ts`
- Create: `apps/agent/src/runtime/handlers/pre_ping.test.ts`

**Steps:**

1. **TDD:** when cron fires for `pre_ping` kind, the handler:
   - Loads the event
   - Builds a brain prompt using the `lifeagent` skill + the event details + recent memory
   - Calls brain.chat with `send_message` tool available
   - Records the outbound message in `messages`
   - Updates `events.pre_ping_sent_at`

2. **Implement.**
3. **Commit:** `feat(handlers): pre-ping handler`

### Task 8.2 — Post-ping handler

Same pattern. Schedule `post_ping` cron at `endAt`. On fire, send a "did you finish?" message.

### Task 8.3 — Inbound reply handler

When user replies in Telegram and the most recent event has `post_ping_sent_at` but no `user_reply_text`, treat the reply as a status update for that event. Use brain to parse into `{ status, slipped_minutes, blocker }` via `parseStructured` with a Zod schema. Update the event row.

### Task 8.4 — Morning brief + nightly summary cron jobs

Created at user-init time (Phase 14 covers init). Daily at user-tz-7am and user-tz-11pm. Fires the corresponding skill, sends to Telegram.

Commit per task.

---

## Phase 9 — Verifiers

### Task 9.1 — Verifier interface

**Files:**
- Create: `apps/agent/src/verifiers/types.ts`
- Create: `apps/agent/src/verifiers/types.test.ts` (just type-level tests)

**Steps:**

1. Define `Verifier`, `ActivityClaim`, `VerificationResult` per design doc §5.5.
2. Commit.

### Task 9.2 — Strava verifier

**Files:**
- Create: `apps/agent/src/verifiers/strava.ts`
- Create: `apps/agent/src/verifiers/strava.test.ts`

**Steps:**

1. **OAuth flow** — separate task in Phase 14 (web dashboard does the OAuth dance). For v1 testing, accept a refresh token in the integrations table.
2. **TDD with mocked Strava API:** given a claim with `kind: "exercise"` and a window, return `consistent: true` if any activity overlaps the window, else `consistent: false`.
3. **Implement** using `fetch` to `https://www.strava.com/api/v3/athlete/activities`. Refresh access token if expired.
4. **Commit:** `feat(verifiers): Strava activity verifier`

### Task 9.3 — GitHub verifier

Use a PAT for v1 (config-only, no OAuth). Query GraphQL `viewer.contributionsCollection.commitContributionsByRepository` filtered by date.

### Task 9.4 — Wakatime verifier

Use API key. Query `users/current/summaries?start=...&end=...`. `consistent` if `categories.coding.total_seconds > threshold`.

Commit each verifier.

### Task 9.5 — `query_verifier` tool

**Files:**
- Create: `apps/agent/src/runtime/tools/query_verifier.ts`

Tool input: `{ verifier, claim }`. Output: `VerificationResult`. Persists result to `verification_runs`.

---

## Phase 10 — Confrontation logic

### Task 10.1 — Auto-verification on post-ping reply

**Files:**
- Modify: `apps/agent/src/runtime/handlers/post_ping_reply.ts`

After parsing user reply in Phase 8.3, if `event.kind` (or skill-inferred kind) maps to a verifier:
- Run the verifier against the event window
- If `consistent: false` and `confidence > 0.7`: enqueue a follow-up message via the agent loop with the verification context. The skill enforces "never confront without `verification_run.id`."
- If `inconclusive`: do nothing.
- Update `events.verification_status`.

TDD with mocked verifier returning each branch.

Commit.

---

## Phase 11 — Telegram escalation ladder

### Task 11.1 — Escalation cron jobs

**Files:**
- Modify: `apps/agent/src/runtime/handlers/post_ping.ts`
- Create: `apps/agent/src/runtime/handlers/escalation.ts`

When `post_ping` fires and the user has not replied within 5 / 15 / 30 minutes, schedule successive cron jobs that send increasingly intense messages.

TDD: simulate non-reply, assert escalation cron jobs are scheduled and executed in order, asserting each message tone via skill output.

### Task 11.2 — Accountability contact ping

If `OWNER_CONTACT_TELEGRAM_ID` env is set and 30-min escalation hits, send a one-line ping to that chat ("Santo missed `<event>`. Ping him?"). Disabled by default; opt-in via env.

Commit per task.

---

## Phase 12 — Gcal source adapter

### Task 12.1 — Google OAuth setup

**Files:**
- Create: `apps/agent/src/adapters/gcal/oauth.ts`
- (Web OAuth flow in Phase 14.)

**Steps:**

1. Use `googleapis` SDK. `cd apps/agent && bun add googleapis`
2. Implement token exchange, refresh, and `getAuthClient(userId)` reading from `integrations`.
3. TDD with mocked googleapis.
4. Commit.

### Task 12.2 — `gcal` adapter (read + write back)

**Files:**
- Create: `apps/agent/src/adapters/gcal/index.ts`

Implements `SourceAdapter`. `syncEvents()` pulls today's events, upserts into `events` table with `source: "gcal"`. `pushUpdate()` writes a reschedule back to Gcal.

### Task 12.3 — Sync cron

A 5-min cron that calls `gcal.syncEvents()` for each user with a Gcal integration.

Commit each.

---

## Phase 13 — CLI

### Task 13.1 — CLI entry

**Files:**
- Create: `apps/agent/src/cli/index.ts`
- Modify: `apps/agent/package.json` (add `bin: { lifeagent: "./src/cli/index.ts" }`)

**Steps:**

1. Use Bun's built-in argv parsing (or `commander` if useful).
2. Subcommands:
   - `lifeagent start` — boots the runtime + Telegram + cron
   - `lifeagent plan` — interactive prompt to create today's plan
   - `lifeagent status` — current event + counts
   - `lifeagent inbox` — pending replies / unverified events
   - `lifeagent replay <event-id>` — re-run pings for a past event
   - `lifeagent verify-now <event-id>` — manually trigger verifier
3. TDD each subcommand at the integration level.
4. Commit per subcommand.

---

## Phase 14 — Web dashboard scaffold

### Task 14.1 — Next.js 15 init

```bash
cd apps && bunx create-next-app@latest web --ts --tailwind --app --no-src-dir --import-alias "@/*" --turbopack
```

Move the generated `package.json` to use `@lifeagent/db` and `@lifeagent/types` as workspace deps. Commit.

### Task 14.2 — shadcn/ui init + base theme

`bunx shadcn@latest init`. Pick neutral/zinc theme. Commit.

### Task 14.3 — Telegram Login Widget auth

Implement single-user auth: the Telegram Login Widget posts a signed payload to `/api/auth/telegram` which verifies HMAC against `TELEGRAM_BOT_TOKEN` and sets a signed JWT cookie. Compare `id` against `OWNER_TELEGRAM_ID`. Commit.

### Task 14.4 — Web SDK client

`apps/web/lib/sdk.ts` is a thin client that calls `/api/sdk/*` route handlers which import `@lifeagent/agent`'s `LifeAgentSDK` directly (server-side). Commit.

---

## Phase 15 — Web dashboard pages

Each page is its own task with at least one playwright e2e or vitest component test.

- `/` — today timeline
- `/week` — week view
- `/history` — event log with filters
- `/memory` — durable facts the agent has learned, edit + delete
- `/settings` — integrations OAuth start, brain provider, cron times, escalation contact

Commit per page.

---

## Phase 16 — OpenAI + Ollama brain adapters

Same shape as Anthropic adapter. TDD with mocked clients.

Commit per adapter.

---

## Phase 17 — Docker, README, demo

### Task 17.1 — Production Dockerfiles

- `Dockerfile.agent` — multi-stage Bun build, runs `bun run apps/agent/dist/index.js`
- `Dockerfile.web` — Next.js standalone output

### Task 17.2 — `docker-compose.yml`

Postgres + agent + web on a single `lifeagent` network. Healthchecks. Volumes for Postgres data.

### Task 17.3 — README

Walkthrough of: BotFather token, env file, `docker compose up -d`, OAuth into integrations, first plan. Demo gif (recorded with `playwright-recording` skill).

### Task 17.4 — Tag `v0.1.0`

After all tests green and full smoke test on a clean machine.

---

## Definition of done (v1)

- [ ] All tests pass on `bun run test`
- [ ] `bun run lint` passes
- [ ] `docker compose up -d` brings up agent + web + postgres on a fresh Ubuntu VM and the maintainer can `/start` the bot, schedule an event via chat, get pre-ping, reply, and see verification cross-check
- [ ] No `// TODO` or `// FIXME` in `apps/agent/src` or `apps/web/app`
- [ ] README has working demo gif under 30 seconds showing the loop
- [ ] At least one verifier (Strava OR GitHub) catches a real false self-report by the maintainer in dogfooding
- [ ] `v0.1.0` tag pushed to GitHub

---

## Skills referenced

- `superpowers:test-driven-development` — every task uses TDD
- `superpowers:verification-before-completion` — before marking each phase complete
- `superpowers:executing-plans` — for the executor session
- `superpowers:requesting-code-review` — at end of each phase

---

## Open questions to resolve as we execute

1. Voice notes in Phase 5.2 — Anthropic doesn't have TTS. Use OpenAI TTS as a stopgap, or skip voice notes for v1 and just escalate via text intensity? **Default: skip voice notes for v1**, revisit if it matters.
2. Which Anthropic model for chat in v1: `claude-sonnet-4-6` or `claude-opus-4-7`? Sonnet is cheaper and fast enough; Opus is overkill. **Default: Sonnet 4.6.**
3. CLI `lifeagent plan` — interactive mode is a bigger build than v1 needs. **Default: keep it as a single-line flag-driven create for v1; full interactive in v2.**
