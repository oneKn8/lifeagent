import { beforeEach, describe, expect, it } from "bun:test";
import { type Db, createUser, getCronJobById, makeTestDb } from "@lifeagent/db";
import { CronScheduler } from "./cron";
import { HookBus } from "./hooks";

describe("CronScheduler", () => {
  let db: Db;
  let hooks: HookBus;

  beforeEach(async () => {
    db = await makeTestDb();
    hooks = new HookBus();
  });

  it("schedules a one-shot job with nextRunAt", async () => {
    const user = await createUser(db, { telegramId: "tg_cs1" });
    const sched = new CronScheduler({ db, hooks });
    const fireAt = new Date("2026-05-04T12:00:00Z");
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "pre_ping",
      nextRunAt: fireAt,
      payload: { eventId: "ev1" },
    });
    const row = await getCronJobById(db, id);
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("pre_ping");
    expect(row?.nextRunAt?.toISOString()).toBe(fireAt.toISOString());
    expect(row?.status).toBe("active");
  });

  it("requires either nextRunAt or scheduleExpr", async () => {
    const user = await createUser(db, { telegramId: "tg_cs1b" });
    const sched = new CronScheduler({ db, hooks });
    await expect(sched.schedule({ userId: user.id, kind: "verify" })).rejects.toThrow();
  });

  it("tickOnce fires a due one-shot job and marks last_run_at", async () => {
    const user = await createUser(db, { telegramId: "tg_cs2" });
    const sched = new CronScheduler({ db, hooks });
    let firedWith: string | null = null;
    sched.registerHandler("pre_ping", async (job) => {
      firedWith = job.id;
    });
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "pre_ping",
      nextRunAt: new Date("2026-05-04T11:00:00Z"),
    });
    const result = await sched.tickOnce(new Date("2026-05-04T12:00:00Z"));
    expect(result.fired).toBe(1);
    expect(result.failed).toBe(0);
    expect(firedWith).toBe(id);
    const row = await getCronJobById(db, id);
    expect(row?.lastRunAt).toBeInstanceOf(Date);
    // one-shot is now disabled
    expect(row?.status).toBe("done");
    expect(row?.nextRunAt).toBeNull();
  });

  it("tickOnce does not fire a future job", async () => {
    const user = await createUser(db, { telegramId: "tg_cs3" });
    const sched = new CronScheduler({ db, hooks });
    let fires = 0;
    sched.registerHandler("verify", async () => {
      fires += 1;
    });
    await sched.schedule({
      userId: user.id,
      kind: "verify",
      nextRunAt: new Date("2026-05-04T15:00:00Z"),
    });
    const result = await sched.tickOnce(new Date("2026-05-04T12:00:00Z"));
    expect(result.fired).toBe(0);
    expect(fires).toBe(0);
  });

  it("recurring job: after firing, next_run_at is the next cron occurrence", async () => {
    const user = await createUser(db, { telegramId: "tg_cs4" });
    const sched = new CronScheduler({ db, hooks });
    sched.registerHandler("morning_brief", async () => {
      // no-op
    });
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "morning_brief",
      scheduleExpr: "0 9 * * *", // 09:00 UTC daily
    });
    // First scheduling should set nextRunAt to the next 09:00 UTC after now.
    const firstRow = await getCronJobById(db, id);
    expect(firstRow?.nextRunAt).toBeInstanceOf(Date);

    const tickAt = firstRow?.nextRunAt ?? new Date();
    const result = await sched.tickOnce(new Date(tickAt.getTime() + 1000));
    expect(result.fired).toBe(1);

    const row = await getCronJobById(db, id);
    expect(row?.status).toBe("active");
    expect(row?.nextRunAt).toBeInstanceOf(Date);
    expect((row?.nextRunAt as Date).getTime()).toBeGreaterThan(tickAt.getTime());
  });

  it("handler throws: retry_count increments and next_run_at shifts by backoff", async () => {
    const user = await createUser(db, { telegramId: "tg_cs5" });
    const sched = new CronScheduler({ db, hooks, backoffSecs: [60, 120, 300], maxRetries: 3 });
    sched.registerHandler("verify", async () => {
      throw new Error("simulated failure");
    });
    const baseTime = new Date("2026-05-04T12:00:00Z");
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "verify",
      nextRunAt: baseTime,
    });
    const result = await sched.tickOnce(baseTime);
    expect(result.fired).toBe(0);
    expect(result.failed).toBe(1);
    const row = await getCronJobById(db, id);
    expect(row?.retryCount).toBe(1);
    expect(row?.status).toBe("active");
    // next_run_at should be roughly baseTime + 60s
    const next = row?.nextRunAt as Date;
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBe(baseTime.getTime() + 60_000);
  });

  it("after maxRetries failures: status becomes failed, no further fires", async () => {
    const user = await createUser(db, { telegramId: "tg_cs6" });
    const sched = new CronScheduler({ db, hooks, backoffSecs: [1, 1, 1], maxRetries: 2 });
    let attempts = 0;
    sched.registerHandler("verify", async () => {
      attempts += 1;
      throw new Error("fail");
    });
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "verify",
      nextRunAt: new Date("2026-05-04T12:00:00Z"),
    });
    // Tick repeatedly past each rescheduled time
    await sched.tickOnce(new Date("2026-05-04T12:00:00Z"));
    let row = await getCronJobById(db, id);
    expect(row?.retryCount).toBe(1);
    await sched.tickOnce(new Date(row?.nextRunAt as Date));
    row = await getCronJobById(db, id);
    expect(row?.retryCount).toBe(2);
    await sched.tickOnce(new Date(row?.nextRunAt as Date));
    row = await getCronJobById(db, id);
    expect(row?.status).toBe("failed");
    expect(attempts).toBe(3);
    // No further fires
    const last = await sched.tickOnce(new Date("2026-06-01T00:00:00Z"));
    expect(last.fired).toBe(0);
    expect(last.failed).toBe(0);
    expect(attempts).toBe(3);
  });

  it("pre_cron_fire hook cancellation skips the handler", async () => {
    const user = await createUser(db, { telegramId: "tg_cs7" });
    const sched = new CronScheduler({ db, hooks });
    let calls = 0;
    sched.registerHandler("pre_ping", async () => {
      calls += 1;
    });
    hooks.register("pre_cron_fire", async () => ({ cancel: true, reason: "paused" }));
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "pre_ping",
      nextRunAt: new Date("2026-05-04T12:00:00Z"),
    });
    const result = await sched.tickOnce(new Date("2026-05-04T12:00:01Z"));
    expect(result.fired).toBe(0);
    expect(result.failed).toBe(0);
    expect(calls).toBe(0);
    // Job is still pending (untouched)
    const row = await getCronJobById(db, id);
    expect(row?.status).toBe("active");
    expect(row?.lastRunAt).toBeNull();
  });

  it("missing handler does not crash and counts as failure", async () => {
    const user = await createUser(db, { telegramId: "tg_cs8" });
    const sched = new CronScheduler({ db, hooks, backoffSecs: [10] });
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "nightly_summary",
      nextRunAt: new Date("2026-05-04T12:00:00Z"),
    });
    const result = await sched.tickOnce(new Date("2026-05-04T12:00:01Z"));
    expect(result.failed).toBe(1);
    const row = await getCronJobById(db, id);
    expect(row?.retryCount).toBe(1);
  });

  it("cancel(id) disables a job", async () => {
    const user = await createUser(db, { telegramId: "tg_cs9" });
    const sched = new CronScheduler({ db, hooks });
    let calls = 0;
    sched.registerHandler("pre_ping", async () => {
      calls += 1;
    });
    const { id } = await sched.schedule({
      userId: user.id,
      kind: "pre_ping",
      nextRunAt: new Date("2026-05-04T12:00:00Z"),
    });
    await sched.cancel(id);
    const row = await getCronJobById(db, id);
    expect(row?.status).toBe("cancelled");
    const result = await sched.tickOnce(new Date("2026-05-04T13:00:00Z"));
    expect(result.fired).toBe(0);
    expect(calls).toBe(0);
  });

  it("start/stop ticks at the configured interval", async () => {
    const user = await createUser(db, { telegramId: "tg_cs10" });
    const sched = new CronScheduler({ db, hooks, tickIntervalMs: 30 });
    let fires = 0;
    sched.registerHandler("verify", async () => {
      fires += 1;
    });
    await sched.schedule({
      userId: user.id,
      kind: "verify",
      nextRunAt: new Date(Date.now() - 1000),
    });
    await sched.start();
    await new Promise((r) => setTimeout(r, 120));
    await sched.stop();
    expect(fires).toBeGreaterThanOrEqual(1);
  });
});
