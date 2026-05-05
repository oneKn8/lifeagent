#!/usr/bin/env bun
import { createDbClient } from "@lifeagent/db";
import {
  inboxCommand,
  planCommand,
  replayCommand,
  statusCommand,
  verifyNowCommand,
} from "./commands";
import { parseArgv } from "./parse";

const HELP = `lifeagent — accountability bot CLI

usage:
  lifeagent start
  lifeagent status
  lifeagent inbox
  lifeagent plan --title=<t> --start=<iso> --end=<iso> [--notes=<n>]
  lifeagent replay <event-id>
  lifeagent verify-now <event-id> --verifier=<name> --kind=<kind>
`;

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgv(argv);
  const cmd = parsed.command;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const ownerTelegramId = process.env.OWNER_TELEGRAM_ID;
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL is required\n");
    return 1;
  }
  if (!ownerTelegramId) {
    process.stderr.write("OWNER_TELEGRAM_ID is required\n");
    return 1;
  }
  const db = createDbClient(databaseUrl);

  switch (cmd) {
    case "start": {
      // Production wiring lives in apps/agent/src/index.ts (runtime entrypoint).
      // The CLI's `start` defers there to avoid duplicating env wiring.
      process.stderr.write(
        "lifeagent start: invoke `bun apps/agent/src/index.ts` to boot the runtime.\n",
      );
      return 0;
    }
    case "status": {
      const r = await statusCommand({ db, ownerTelegramId });
      process.stdout.write(r.stdout);
      return r.exitCode;
    }
    case "inbox": {
      const r = await inboxCommand({ db, ownerTelegramId });
      process.stdout.write(r.stdout);
      return r.exitCode;
    }
    case "plan": {
      // The CLI's plan path requires the SDK, which requires brain config.
      // For non-interactive use, we route through the runtime entrypoint.
      process.stderr.write(
        "lifeagent plan: programmatic plan creation requires the runtime SDK; use the web dashboard or the running agent.\n",
      );
      return 2;
    }
    case "replay": {
      process.stderr.write("lifeagent replay: requires the running runtime.\n");
      return 2;
    }
    case "verify-now": {
      process.stderr.write("lifeagent verify-now: requires the running runtime.\n");
      return 2;
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
      return 2;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
