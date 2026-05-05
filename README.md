# lifeagent

> The AI accountability bot that knows what you actually did.

lifeagent pings you on Telegram before and after every event on your calendar.
It reads your fitness, code activity, and screen time, and cross-references
your replies against reality. It won't accept "I did it" if your phone says
you didn't.

**Status:** pre-alpha, under active development. Phases 0-5 of 17 complete.

## Why

- Calendar notifications get dismissed.
- Habit trackers and to-do apps are passive: they record self-reports.
- Human accountability coaches work but cost $140-700/month.
- Existing AI tools wait for you to open them.

lifeagent reaches out first, and verifies what it hears.

## What it does (target v0.1)

- Pre-pings each scheduled event with the title and what you said about it.
- Post-pings to ask for status: started, partial, done, skipped, slipped.
- Cross-references replies against verifiers (Strava, GitHub, Wakatime to
  start; Google Fit, Apple Health, screen time later).
- Confronts contradictions with the evidence and a `verification_run` id.
- Replans downstream events when something slips, after asking first.
- Writes a nightly summary and a morning brief.

## Architecture

- **Runtime** (`apps/agent`) — agent loop, tool registry, skill loader, hook
  bus, persistent cron scheduler, memory store, programmatic SDK.
- **Brain** (`apps/agent/src/brain`) — pluggable provider interface.
  Default: OpenRouter free-tier model rotation. Optional: Anthropic, Ollama.
- **Adapters** — Telegram (grammY) for chat; calendar/health/code/screen
  verifiers wired through a common source-adapter interface.
- **Database** (`packages/db`) — Postgres + Drizzle ORM. Schema covers users,
  events, messages, memory facts, integrations, cron jobs, verification runs.
- **CLI + web dashboard** — planned, Next.js 15.

See `docs/plans/2026-05-04-lifeagent-design.md` for the full design and
`docs/plans/2026-05-04-lifeagent-implementation.md` for the 17-phase build
plan.

## Stack

- Bun runtime + workspaces, TypeScript (strict)
- Postgres 16, Drizzle ORM
- grammY for Telegram
- Biome for lint + format
- Bun's built-in test runner (`bun:test`)

## Running locally

You will need:

- Bun 1.3+
- Docker (for the Postgres dev container)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An [OpenRouter](https://openrouter.ai) API key (free tier works)

```bash
# 1. Install deps
bun install

# 2. Start Postgres (port 5544)
docker compose -f docker-compose.dev.yml up -d

# 3. Configure env
cp -n .env.example .env
# fill in TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID, OPENROUTER_API_KEY,
# ENCRYPTION_KEY (32 random bytes, base64)

# 4. Run migrations
bun --filter @lifeagent/db migrate

# 5. Run tests
bun test

# 6. Lint
bun run lint
```

The agent isn't wired into a single entry point yet — see the implementation
plan for which phase exposes the runnable bot.

## Contributing

Issues and PRs welcome. The codebase follows TDD: every change ships with a
failing test first. Conventional Commits for messages
(`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `style:`).

## License

MIT — see [LICENSE](./LICENSE).
