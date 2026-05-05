import {
  type Db,
  getActiveCronJobsByEventId,
  getEventById,
  getEventsForDay,
  getLatestPendingPostPingEvent,
  getUserByTelegramId,
} from "@lifeagent/db";
import type { CronScheduler } from "../runtime/cron";
import type { LifeAgentSDK } from "../runtime/sdk";
import type { Verifier } from "../verifiers/types";

export interface CommandResult {
  exitCode: number;
  stdout: string;
}

export interface BaseDeps {
  db: Db;
  /** Owner telegram id, used to scope status/inbox to the single-user setup. */
  ownerTelegramId: string;
}

export async function statusCommand(deps: BaseDeps): Promise<CommandResult> {
  const user = await getUserByTelegramId(deps.db, deps.ownerTelegramId);
  if (!user) {
    return { exitCode: 1, stdout: "no user found for owner telegram id\n" };
  }
  const today = await getEventsForDay(deps.db, user.id, new Date());
  const sorted = today.slice().sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const lines: string[] = [];
  lines.push(`user: ${user.id}`);
  lines.push(`today: ${today.length} events`);
  for (const e of sorted) {
    lines.push(`  ${e.startAt.toISOString().slice(11, 16)}  [${e.status}]  ${e.title}`);
  }
  return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
}

export async function inboxCommand(deps: BaseDeps): Promise<CommandResult> {
  const user = await getUserByTelegramId(deps.db, deps.ownerTelegramId);
  if (!user) {
    return { exitCode: 1, stdout: "no user found\n" };
  }
  const pending = await getLatestPendingPostPingEvent(deps.db, user.id);
  if (!pending) {
    return { exitCode: 0, stdout: "inbox: empty\n" };
  }
  return {
    exitCode: 0,
    stdout: `pending reply for: ${pending.title} (id ${pending.id})\n`,
  };
}

export interface PlanArgs {
  title: string;
  start: string; // ISO
  end: string; // ISO
  notes?: string;
}

export async function planCommand(
  deps: BaseDeps & { sdk: Pick<LifeAgentSDK, "addManualEvent"> },
  args: PlanArgs,
): Promise<CommandResult> {
  const user = await getUserByTelegramId(deps.db, deps.ownerTelegramId);
  if (!user) {
    return { exitCode: 1, stdout: "no user found\n" };
  }
  const startAt = new Date(args.start);
  const endAt = new Date(args.end);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { exitCode: 2, stdout: "invalid --start or --end\n" };
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return { exitCode: 2, stdout: "--end must be after --start\n" };
  }
  const { eventId } = await deps.sdk.addManualEvent({
    userId: user.id,
    title: args.title,
    startAt,
    endAt,
    notes: args.notes,
  });
  return { exitCode: 0, stdout: `created event ${eventId}\n` };
}

export interface ReplayArgs {
  eventId: string;
}

export async function replayCommand(
  deps: BaseDeps & { cron: CronScheduler },
  args: ReplayArgs,
): Promise<CommandResult> {
  const user = await getUserByTelegramId(deps.db, deps.ownerTelegramId);
  if (!user) {
    return { exitCode: 1, stdout: "no user found\n" };
  }
  const event = await getEventById(deps.db, args.eventId);
  if (!event) {
    return { exitCode: 2, stdout: `event ${args.eventId} not found\n` };
  }
  if (event.userId !== user.id) {
    return { exitCode: 3, stdout: "event does not belong to owner\n" };
  }
  const preJobs = await getActiveCronJobsByEventId(deps.db, event.id, "pre_ping");
  for (const job of preJobs) {
    await deps.cron.runJob(job.id);
  }
  const postJobs = await getActiveCronJobsByEventId(deps.db, event.id, "post_ping");
  for (const job of postJobs) {
    await deps.cron.runJob(job.id);
  }
  return {
    exitCode: 0,
    stdout: `replayed pre=${preJobs.length} post=${postJobs.length}\n`,
  };
}

export interface VerifyNowArgs {
  eventId: string;
  verifier: string;
  kind: "exercise" | "code" | "study" | "focus" | "custom";
  reportedStatus?: "done" | "partial" | "skipped";
}

export async function verifyNowCommand(
  deps: BaseDeps & { verifiers: Map<string, Verifier> },
  args: VerifyNowArgs,
): Promise<CommandResult> {
  const user = await getUserByTelegramId(deps.db, deps.ownerTelegramId);
  if (!user) {
    return { exitCode: 1, stdout: "no user found\n" };
  }
  const event = await getEventById(deps.db, args.eventId);
  if (!event) {
    return { exitCode: 2, stdout: `event ${args.eventId} not found\n` };
  }
  const verifier = deps.verifiers.get(args.verifier);
  if (!verifier) {
    return { exitCode: 3, stdout: `unknown verifier: ${args.verifier}\n` };
  }
  const result = await verifier.verify({
    eventId: event.id,
    userId: user.id,
    kind: args.kind,
    windowStart: event.startAt,
    windowEnd: event.endAt,
    reportedStatus: args.reportedStatus ?? "done",
  });
  return {
    exitCode: 0,
    stdout: `${result.verifier}: consistent=${result.consistent} confidence=${result.confidence.toFixed(2)} — ${result.summary}\n`,
  };
}
