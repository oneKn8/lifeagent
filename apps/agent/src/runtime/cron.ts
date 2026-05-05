import {
  type CronJob,
  type CronJobKind,
  type Db,
  cancelCronJob,
  createCronJob,
  getDueCronJobs,
  markCronJobRan,
  recordCronJobFailure,
} from "@lifeagent/db";
import { CronExpressionParser } from "cron-parser";
import type { HookBus } from "./hooks";

export type CronKind = CronJobKind;

export interface ScheduleInput {
  userId: string;
  kind: CronKind;
  /** For one-shot jobs. */
  nextRunAt?: Date;
  /** For recurring jobs (cron-style "0 7 * * *"). */
  scheduleExpr?: string;
  payload?: unknown;
}

export type CronHandler = (job: CronJob, ctx: { db: Db }) => Promise<void>;

export interface CronSchedulerOptions {
  db: Db;
  hooks: HookBus;
  /** How often to tick when started. Default 5000ms. */
  tickIntervalMs?: number;
  /** Maximum number of retry attempts before marking failed. Default 3. */
  maxRetries?: number;
  /** Backoff seconds keyed by retry attempt. Default [60, 120, 300]. */
  backoffSecs?: number[];
}

const ONE_SHOT_TOKEN = "@once";

export class CronScheduler {
  private readonly db: Db;
  private readonly hooks: HookBus;
  private readonly tickIntervalMs: number;
  private readonly maxRetries: number;
  private readonly backoffSecs: number[];
  private readonly handlers = new Map<CronKind, CronHandler>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<unknown> | null = null;

  constructor(opts: CronSchedulerOptions) {
    this.db = opts.db;
    this.hooks = opts.hooks;
    this.tickIntervalMs = opts.tickIntervalMs ?? 5000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffSecs = opts.backoffSecs ?? [60, 120, 300];
  }

  registerHandler(kind: CronKind, handler: CronHandler): void {
    this.handlers.set(kind, handler);
  }

  async schedule(input: ScheduleInput): Promise<{ id: string }> {
    if (!input.nextRunAt && !input.scheduleExpr) {
      throw new Error("schedule: either nextRunAt or scheduleExpr is required");
    }

    let nextRunAt: Date;
    let scheduleExpr: string;
    if (input.scheduleExpr) {
      scheduleExpr = input.scheduleExpr;
      nextRunAt = input.nextRunAt ?? this.computeNextOccurrence(input.scheduleExpr, new Date());
    } else {
      scheduleExpr = ONE_SHOT_TOKEN;
      nextRunAt = input.nextRunAt as Date;
    }

    const job = await createCronJob(this.db, {
      userId: input.userId,
      scheduleExpr,
      kind: input.kind,
      payload: input.payload,
      nextRunAt,
    });
    return { id: job.id };
  }

  async cancel(jobId: string): Promise<void> {
    await cancelCronJob(this.db, jobId);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.tickOnce()
        .catch((err) => {
          process.stderr.write(`CronScheduler tick error: ${(err as Error).message}\n`);
        })
        .finally(() => {
          this.inFlight = null;
        });
    }, this.tickIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => {});
      this.inFlight = null;
    }
  }

  async tickOnce(now: Date = new Date()): Promise<{ fired: number; failed: number }> {
    const due = await getDueCronJobs(this.db, now);
    let fired = 0;
    let failed = 0;
    for (const job of due) {
      const result = await this.fireOne(job, now);
      if (result === "fired") fired += 1;
      else if (result === "failed") failed += 1;
    }
    return { fired, failed };
  }

  private async fireOne(job: CronJob, now: Date): Promise<"fired" | "failed" | "skipped"> {
    const cancellation = await this.hooks.emit("pre_cron_fire", {
      jobId: job.id,
      kind: job.kind,
    });
    if (cancellation.cancel) return "skipped";

    const handler = this.handlers.get(job.kind);
    if (!handler) {
      process.stderr.write(`CronScheduler: no handler registered for kind=${job.kind}\n`);
      await this.handleFailure(job, now);
      return "failed";
    }

    try {
      await handler(job, { db: this.db });
    } catch (err) {
      process.stderr.write(
        `CronScheduler: handler for ${job.kind} threw: ${(err as Error).message}\n`,
      );
      await this.handleFailure(job, now);
      return "failed";
    }

    const nextRunAt = this.isRecurring(job)
      ? this.computeNextOccurrence(job.scheduleExpr, now)
      : null;
    await markCronJobRan(this.db, job.id, nextRunAt);
    return "fired";
  }

  private async handleFailure(job: CronJob, now: Date): Promise<void> {
    const attempts = job.retryCount + 1;
    if (attempts > this.maxRetries) {
      await recordCronJobFailure(this.db, job.id, { nextRunAt: null, failed: true });
      return;
    }
    const idx = Math.min(job.retryCount, this.backoffSecs.length - 1);
    const backoffMs = (this.backoffSecs[idx] ?? 60) * 1000;
    const nextRunAt = new Date(now.getTime() + backoffMs);
    await recordCronJobFailure(this.db, job.id, { nextRunAt, failed: false });
  }

  private isRecurring(job: CronJob): boolean {
    return job.scheduleExpr !== ONE_SHOT_TOKEN;
  }

  private computeNextOccurrence(expr: string, after: Date): Date {
    const parsed = CronExpressionParser.parse(expr, { currentDate: after, tz: "UTC" });
    return parsed.next().toDate();
  }
}
