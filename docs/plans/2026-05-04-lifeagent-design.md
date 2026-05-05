# lifeagent — Design Document

**Date:** 2026-05-04
**Status:** Approved (brainstorming phase complete)
**License:** MIT
**Repo:** `/home/oneknight/projects/lifeagent/` (to be pushed to GitHub)

---

## 1. One-liner

> **lifeagent — the AI accountability bot that knows what you actually did.**
> Pings you before and after every event on Telegram. Reads your fitness, code activity, and screen time. Won't accept "I did it" if your phone says you didn't.

---

## 2. Why this exists

### The problem
- Calendar notifications get dismissed.
- Habit trackers and to-do apps are passive — they record self-reports.
- Human accountability coaches work but cost $140-700/month.
- Existing AI tools (Claude, ChatGPT, etc.) wait for you to open them.

### The wedge
**Verified accountability.** A bot that:
1. Reaches you proactively on Telegram before and after each scheduled item.
2. Cross-references your reply against real activity data (Strava, Google Fit, Apple Health, Wakatime, GitHub, Screen Time, GPS).
3. Calls you out when your reply contradicts reality.
4. Replans the rest of the day when something slips.

Generic LLM products don't do this. Building it on top of generic LLMs requires significant glue work most users will not do. lifeagent ships as a working product with one config file.

---

## 3. Non-goals (explicit, locked)

- **Not** a generic chat assistant.
- **Not** a calendar/todo app replacement (sources feed *into* it).
- **Not** a coaching service (no human in the loop).
- **Not** a SaaS in v1 (single-user self-host).
- **Not** dependent on any proprietary CLI/runtime.

---

## 4. Differentiation (what makes ignoring harder)

**v1 ships two differentiators:**

### 4.1 Activity verification ("you can't lie to it")
Read-only OAuth into:
- **Strava** — gym/run sessions
- **GitHub** — commit activity for "code 2 hours" blocks
- **Wakatime** — IDE active time
- (Pluggable: Google Fit, Apple Health, RescueTime, Screen Time, Spotify added later via adapter pattern)

When user reports "done," the verifier checks the relevant data window. If contradicted, the agent calls it out:
> "Your reply says gym was done but Strava has no activity since Tuesday and your phone reported zero steps before 9am. Try again."

### 4.2 Telegram-native escalation ladder
Single channel (Telegram), but message intensity escalates on no-reply:
- **T+0** event start: normal pre-ping.
- **T+5min** no reply: voice note ("hey, you started yet?").
- **T+15min** no reply: rapid-fire 3-message burst with stickers.
- **T+30min** no reply: notify accountability contact (opt-in, single contact in env config) — "Santo missed gym again, ping him?"
- **End of day**: skipped events appear in nightly summary regardless.

No Twilio, no SMS, no voice calls in v1 — Telegram only. Cost = $0.

**v2/v3 differentiators (locked out of v1):** mobile companion app with iOS Critical Alerts + geofencing, public scoreboard / social pressure, desktop takeover, Twilio voice escalation.

---

## 5. Architecture

### 5.1 High-level

```
┌────────────────────────────────────────────────────────────────────┐
│                         CHANNELS                                   │
│   [Telegram bot]   [Web dashboard]   [CLI]                         │
└────────┬──────────────────┬─────────────────┬─────────────────────┘
         │                  │                 │
         ▼                  ▼                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                       RUNTIME (apps/agent)                         │
│                                                                    │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│   │  Tools   │  │  Cron    │  │ Skills   │  │  Hooks   │           │
│   │ Registry │  │Scheduler │  │ Loader   │  │ (pre/post)│          │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
│                                                                    │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                         │
│   │ Memory   │  │Verifiers │  │  Brain   │                         │
│   │  Store   │  │ (Strava, │  │ (LLM     │                         │
│   │ (events, │  │  GitHub, │  │ provider │                         │
│   │  facts)  │  │ Wakatime)│  │  swap)   │                         │
│   └──────────┘  └──────────┘  └──────────┘                         │
└────────┬───────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                       PERSISTENCE                                  │
│   Postgres (events, messages, memory_facts, habits, integrations,  │
│              cron_jobs, verification_runs)                         │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 Runtime modules

| Module | Responsibility |
|---|---|
| `runtime/tools.ts` | Tool interface + registry. Each tool has `name`, `description`, `inputSchema`, `run(input, ctx)`. |
| `runtime/cron.ts` | Cron scheduler. `Create/Delete/List` operations. Persistent (rows in `cron_jobs`). Handles retries with exponential backoff. Sessions: `main`, `isolated`, `custom`. |
| `runtime/skills.ts` | Skill loader. Reads `.md` files with YAML frontmatter from `apps/agent/src/skills/`. Hot-reloads on file change. |
| `runtime/memory.ts` | Memory store interface. Persistence + retrieval of `memory_facts`. v1: simple SELECT with ORDER BY `last_used_at`. v2: pgvector. |
| `runtime/hooks.ts` | Pre/post hooks for tool calls, messages, cron fires. Used for audit logging, permission checks, telemetry. |
| `runtime/loop.ts` | The agent loop: receive event → enrich context → call brain → execute tool calls → repeat until `done` or budget exceeded. |
| `runtime/sdk.ts` | Programmatic API. Web dashboard calls into the runtime via this rather than HTTP. |

### 5.3 Channels

| Channel | Implementation |
|---|---|
| `adapters/telegram.ts` | `grammY` bot. Long-poll in dev, webhook in prod. Outbound message + voice note + sticker tools. Inbound updates routed to runtime via `runtime/loop.ts`. |
| `adapters/web.ts` | Next.js 15 app, calls `runtime/sdk.ts` via Next API routes. Read-only timeline, history, memory viewer + manual event editor. |
| `cli/index.ts` | Bun-native CLI. `lifeagent start | plan | status | inbox | replay | verify-now`. |

### 5.4 Source adapters (calendar/todo data into the system)

| Adapter | v1 status | Purpose |
|---|---|---|
| `manual` | shipped | Events created via Telegram chat or web dashboard. |
| `gcal` | shipped | Google Calendar OAuth, read events, write reschedules back. |
| `notion` | interface ready, impl deferred | v2. |
| `outlook` / `apple-cal` | interface ready, impl deferred | v3. |

The `SourceAdapter` interface:
```typescript
interface SourceAdapter {
  name: string;
  authenticate(userId: string): Promise<void>;
  syncEvents(userId: string, range: DateRange): Promise<EventDelta[]>;
  pushUpdate(userId: string, eventId: string, patch: EventPatch): Promise<void>;
}
```

### 5.5 Verifiers (the differentiating layer)

| Verifier | What it checks | API |
|---|---|---|
| `strava` | activity in time window | OAuth, GET athlete activities |
| `github` | commits in time window | PAT, GraphQL contribution query |
| `wakatime` | coding heartbeats | API key, summaries endpoint |
| (later) `google-fit`, `apple-health`, `rescuetime`, `spotify`, `screentime` | various |

The `Verifier` interface:
```typescript
interface Verifier {
  name: string;
  authenticate(userId: string): Promise<void>;
  verify(claim: ActivityClaim): Promise<VerificationResult>;
}

type ActivityClaim = {
  eventId: string;
  kind: "exercise" | "code" | "study" | "focus" | "custom";
  windowStart: Date;
  windowEnd: Date;
  reportedStatus: "done" | "partial" | "skipped";
};

type VerificationResult = {
  verifier: string;
  evidence: any;        // raw provider response (audit trail)
  consistent: boolean;  // does it match the claim?
  confidence: number;   // 0..1
  summary: string;      // "no Strava activity in this window"
};
```

The agent calls verifiers when a post-event reply lands. If any verifier returns `consistent: false` with high confidence, the agent confronts the user with the evidence in its next message.

### 5.6 Brain (LLM provider)

Provider-swappable interface. v1 ships:
- **Anthropic Claude** (Sonnet for chat/planning, Haiku for cheap parsing/summary)
- **OpenAI** adapter (fallback)
- **Ollama** adapter (local, for self-hosters who don't want any cloud LLM)

```typescript
interface Brain {
  chat(input: ChatInput): AsyncIterable<ChatChunk>;
  parseStructured<T>(prompt: string, schema: ZodSchema<T>): Promise<T>;
}
```

### 5.7 Skills (markdown prompts)

Located at `apps/agent/src/skills/`. Each skill is a `.md` file with YAML frontmatter:

```yaml
---
name: lifeagent
description: Main planner + accountability persona
type: persona
triggers: [chat, pre_ping, post_ping, replan]
---
You are lifeagent, the user's no-bullshit accountability bot...
```

v1 ships:
- `lifeagent.md` — main persona
- `daily-brief.md` — morning briefing
- `daily-summary.md` — nightly rollup
- `reschedule.md` — replan-on-slip
- `memory-extractor.md` — extract durable facts from chat

Skills are hot-reloaded; editing one updates the agent without restart.

### 5.8 Hooks

| Hook | When | Use |
|---|---|---|
| `pre_tool` | before any tool runs | permission check, telemetry |
| `post_tool` | after tool runs | audit log, error handling |
| `pre_message_send` | before outbound channel msg | rate limit, logging |
| `pre_cron_fire` | before scheduled job runs | claim lock, dedupe |
| `post_event_reply` | after user reply to a ping | trigger verifier, update event |

---

## 6. Data model (Postgres + Drizzle)

```
users
  id, telegram_id, email, tz, created_at

events
  id, user_id, source ("manual"|"gcal"|...), external_id,
  title, start_at, end_at,
  status ("planned"|"in_progress"|"done"|"skipped"|"slipped"|"blocked"),
  pre_ping_at, pre_ping_sent_at, post_ping_at, post_ping_sent_at,
  user_reply_text, parsed_state jsonb,
  verification_status ("pending"|"consistent"|"contradicted"|"inconclusive"),
  verification_runs jsonb,  -- array of VerificationResult
  notes, created_at, updated_at

messages
  id, user_id, role ("user"|"agent"|"system"|"tool"),
  channel ("telegram"|"web"|"cli"),
  content, attachments jsonb,
  related_event_id (nullable),
  created_at

memory_facts
  id, user_id,
  kind ("preference"|"habit"|"constraint"|"context"),
  body, confidence,
  source_message_id, last_used_at, created_at

habits
  id, user_id, name, target_freq, current_streak, longest_streak,
  last_done_at, history jsonb

integrations
  id, user_id,
  kind ("gcal"|"strava"|"github"|"wakatime"|...),
  credentials_encrypted, status, last_sync_at, scopes jsonb

cron_jobs
  id, user_id,
  schedule_expr, kind ("pre_ping"|"post_ping"|"morning_brief"|"nightly_summary"|"verify"),
  payload jsonb,
  last_run_at, next_run_at, status, retry_count

verification_runs
  id, user_id, event_id, verifier,
  consistent, confidence, summary, evidence jsonb,
  created_at
```

---

## 7. Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | **TypeScript** | One language across runtime + web. Easy OSS contribution. |
| Runtime | **Bun** | Fast startup, built-in TS, native SQLite, single binary. |
| Web | **Next.js 15 (App Router)** + Tailwind v4 + shadcn/ui | Production-ready, fast iteration, good defaults. |
| DB | **Postgres** + **Drizzle ORM** | Concurrent access from runtime + web; type-safe queries. |
| Telegram | **grammY** | Modern, type-safe, plugin-friendly. |
| Cron | **node-cron** + persistent rows in `cron_jobs` | Keep it simple; upgrade to BullMQ if needed later. |
| LLM | **Anthropic SDK** primary; OpenAI + Ollama adapters | Provider-swappable. |
| Auth (web) | **Telegram Login Widget** | Zero-friction for the one user. |
| Container | **Docker compose** | One-command self-host. |
| License | **MIT** | OSS-friendly, forkable. |

---

## 8. Repo layout

```
lifeagent/
  apps/
    agent/                  # Bun service
      src/
        runtime/            # tools, cron, skills, memory, hooks, loop, sdk
        adapters/           # telegram, gcal, manual
        brain/              # anthropic, openai, ollama
        verifiers/          # strava, github, wakatime
        skills/             # markdown skills
        cli/                # `lifeagent` command
        index.ts            # entrypoint
      package.json
    web/                    # Next.js 15 dashboard
      app/
      components/
      lib/                  # SDK client
      package.json
  packages/
    db/                     # Drizzle schema + migrations + queries
    types/                  # shared TS types
  docs/
    plans/                  # design doc, implementation plan
    architecture/           # design notes, patterns chosen
  Dockerfile.agent
  Dockerfile.web
  docker-compose.yml
  package.json              # Bun workspace
  README.md
  LICENSE
```

---

## 9. v1 scope (locked)

### IN
- Custom mini-runtime (tools, cron, skills, memory, hooks, loop, SDK)
- Telegram bot adapter (grammY, webhook + long-poll)
- LLM brain with Anthropic + OpenAI + Ollama adapters
- Source adapters: `manual`, `gcal`
- Verifiers: `strava`, `github`, `wakatime`
- 5 skills: `lifeagent`, `daily-brief`, `daily-summary`, `reschedule`, `memory-extractor`
- Web dashboard (read-mostly): today timeline, week view, history, memory viewer, manual event editor, settings
- CLI: `lifeagent start | plan | status | inbox | replay | verify-now`
- Postgres + Drizzle migrations
- Telegram-native escalation ladder (T+5/T+15/T+30 with intensity steps + opt-in contact ping)
- Docker compose for self-host
- README with setup walkthrough and demo gif
- MIT license

### OUT (deliberate)
- Voice / Twilio / SMS — not v1
- WhatsApp / Discord / Slack channels — Telegram only for v1
- Multi-user / SaaS hosting — single user
- Notion / Outlook / Apple Cal source adapters — interface ready, impl deferred
- Mobile companion app + iOS Critical Alerts + geofencing — v2/v3
- Public scoreboard / social pressure — v2
- Desktop takeover / browser extension — later
- Sub-agent spawning — not needed
- Plan generation by agent — v1 is reactive (you tell it your day or Gcal feeds it); v2 generates plans from habits + memory
- pgvector semantic memory — when memory_facts > ~200 rows
- Stripe / billing — never as v1; user is on F1 visa, monetization out of scope

---

## 10. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Verifier API outages → false "contradicted" verdicts | `inconclusive` is a first-class verification status. Never confront on inconclusive. |
| User finds verification creepy | Verifiers are opt-in per integration. Default off. README is explicit. |
| Telegram rate limits on escalation | Hooks layer has a per-user rate limiter. Hard cap: 10 messages per hour per user. |
| LLM hallucinates a fake "I caught you" message | All confrontation messages must cite a `verification_run.id`. If no row exists, agent cannot confront. |
| Postgres migration drift in OSS forks | Drizzle migrations checked into repo. CI runs migrations on every PR. |
| Costs balloon | Default Brain = Anthropic Haiku for parsing, Sonnet only on chat. Ollama path documented for fully local self-host. |

---

## 11. Success criteria (v1)

1. Agent runs continuously for 30 days on the maintainer's own VPS without manual intervention.
2. Maintainer's daily compliance (verified vs reported) is logged and visible in dashboard.
3. At least one verifier (Strava or GitHub) catches a false self-report and the agent surfaces it.
4. README + demo gif clear enough that a stranger can self-host in under 15 minutes.
5. First public release tagged `v0.1.0` with no `// TODO` or `// FIXME` in shipped code.

---

## 12. Out-of-scope guardrails (YAGNI list, locked)

These will come up. Locked out of v1 unless explicitly relisted in v2:

- Multi-user, teams, organizations
- Anomaly detection / "agent calls when something's off"
- Coaching tone / personality customization beyond skill-edit
- Multi-language UI
- Voice agent (Retell/Vapi)
- Public marketing site (separate concern)
- Payments / subscriptions
- Browser extensions / desktop apps
- Mobile native apps
- Federated / multi-tenant hosting
- Plugin marketplace
