import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { cronJobs } from "../schema";

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
    .where(and(eq(cronJobs.status, "active"), lte(cronJobs.nextRunAt, now)));
}

export async function markCronJobRan(db: Db, id: string, nextRunAt: Date): Promise<CronJob | null> {
  const [row] = await db
    .update(cronJobs)
    .set({
      lastRunAt: sql`now()`,
      nextRunAt,
    })
    .where(eq(cronJobs.id, id))
    .returning();
  return row ?? null;
}
