import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import {
  createCronJob,
  getDueCronJobs,
  markCronJobRan,
} from "./cron_jobs";
import { createUser } from "./users";

describe("cron_jobs queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("createCronJob inserts a job with defaults", async () => {
    const user = await createUser(db, { telegramId: "tg_c1" });
    const job = await createCronJob(db, {
      userId: user.id,
      scheduleExpr: "0 9 * * *",
      kind: "morning_brief",
      payload: { tz: "America/Chicago" },
      nextRunAt: new Date("2026-05-04T14:00:00Z"),
    });
    expect(job.id).toBeDefined();
    expect(job.kind).toBe("morning_brief");
    expect(job.status).toBe("active");
    expect(job.retryCount).toBe(0);
    expect(job.payload).toEqual({ tz: "America/Chicago" });
  });

  it("getDueCronJobs returns active jobs whose next_run_at <= now", async () => {
    const user = await createUser(db, { telegramId: "tg_c2" });
    const due = await createCronJob(db, {
      userId: user.id,
      scheduleExpr: "* * * * *",
      kind: "verify",
      nextRunAt: new Date("2026-05-04T10:00:00Z"),
    });
    await createCronJob(db, {
      userId: user.id,
      scheduleExpr: "* * * * *",
      kind: "verify",
      nextRunAt: new Date("2026-05-04T15:00:00Z"),
    });
    await createCronJob(db, {
      userId: user.id,
      scheduleExpr: "* * * * *",
      kind: "verify",
      nextRunAt: new Date("2026-05-04T09:00:00Z"),
      status: "paused",
    });

    const rows = await getDueCronJobs(db, new Date("2026-05-04T11:00:00Z"));
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(due.id);
  });

  it("markCronJobRan updates last_run_at and next_run_at", async () => {
    const user = await createUser(db, { telegramId: "tg_c3" });
    const job = await createCronJob(db, {
      userId: user.id,
      scheduleExpr: "* * * * *",
      kind: "pre_ping",
      nextRunAt: new Date("2026-05-04T10:00:00Z"),
    });
    const next = new Date("2026-05-04T11:00:00Z");
    const updated = await markCronJobRan(db, job.id, next);
    expect(updated?.nextRunAt?.toISOString()).toBe(next.toISOString());
    expect(updated?.lastRunAt).toBeInstanceOf(Date);
  });
});
