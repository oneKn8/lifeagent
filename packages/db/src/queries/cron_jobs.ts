import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { cronJobs } from "../schema";

const ACTIVE = "active";

export type CronJob = typeof cronJobs.$inferSelect;
export type CronJobKind = CronJob["kind"];

export interface CreateCronJobInput {
  userId: string;
  scheduleExpr: string;
  kind: CronJobKind;
  payload?: unknown;
  nextRunAt?: Date;
  status?: string;
}

export async function createCronJob(db: Db, input: CreateCronJobInput): Promise<CronJob> {
  const [row] = await db
    .insert(cronJobs)
    .values({
      userId: input.userId,
      scheduleExpr: input.scheduleExpr,
      kind: input.kind,
      payload: input.payload as never,
      nextRunAt: input.nextRunAt,
      status: input.status,
    })
    .returning();
  if (!row) throw new Error("createCronJob: insert returned no row");
  return row;
}

export async function getDueCronJobs(db: Db, now: Date): Promise<CronJob[]> {
  return db
    .select()
    .from(cronJobs)
    .where(
      and(
        eq(cronJobs.status, "active"),
        isNotNull(cronJobs.nextRunAt),
        lte(cronJobs.nextRunAt, now),
      ),
    );
}

export async function getCronJobById(db: Db, id: string): Promise<CronJob | null> {
  const rows = await db.select().from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Marks a job as having just run. Pass `nextRunAt = null` to disable a one-shot
 * job (it sets status="done"). For recurring jobs, supply the next firing time.
 */
export async function markCronJobRan(
  db: Db,
  id: string,
  nextRunAt: Date | null,
): Promise<CronJob | null> {
  const [row] = await db
    .update(cronJobs)
    .set({
      lastRunAt: sql`now()`,
      nextRunAt,
      status: nextRunAt === null ? "done" : undefined,
      retryCount: 0,
    })
    .where(eq(cronJobs.id, id))
    .returning();
  return row ?? null;
}

/**
 * Records a failed attempt: bump retry_count and reschedule next_run_at to
 * `now + backoffSecs`. If `failed` is true, marks the row status="failed".
 */
export async function recordCronJobFailure(
  db: Db,
  id: string,
  opts: { nextRunAt: Date | null; failed: boolean },
): Promise<CronJob | null> {
  const [row] = await db
    .update(cronJobs)
    .set({
      retryCount: sql`${cronJobs.retryCount} + 1`,
      nextRunAt: opts.nextRunAt,
      status: opts.failed ? "failed" : undefined,
    })
    .where(eq(cronJobs.id, id))
    .returning();
  return row ?? null;
}

/**
 * Returns active cron jobs whose payload contains `eventId` matching the given
 * id. Optionally filter by kind (e.g. "pre_ping" or "post_ping").
 */
export async function getActiveCronJobsByEventId(
  db: Db,
  eventId: string,
  kind?: CronJobKind,
): Promise<CronJob[]> {
  const matchPayload = sql`${cronJobs.payload}->>'eventId' = ${eventId}`;
  const where = kind
    ? and(eq(cronJobs.status, ACTIVE), matchPayload, eq(cronJobs.kind, kind))
    : and(eq(cronJobs.status, ACTIVE), matchPayload);
  return db.select().from(cronJobs).where(where);
}

export async function cancelCronJob(db: Db, id: string): Promise<CronJob | null> {
  const [row] = await db
    .update(cronJobs)
    .set({ status: "cancelled", nextRunAt: null })
    .where(eq(cronJobs.id, id))
    .returning();
  return row ?? null;
}
