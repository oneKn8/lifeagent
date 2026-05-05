import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type Db,
  createCronJob,
  createUser,
  getEventByExternalId,
  makeTestDb,
} from "@lifeagent/db";
import type { DateRange, SourceAdapter } from "../../adapters/source";
import { CronScheduler } from "../cron";
import { HookBus } from "../hooks";
import { createGcalSyncHandler } from "./gcal_sync";

describe("gcal_sync handler", () => {
  let db: Db;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    cron = new CronScheduler({ db, hooks: new HookBus() });
  });

  afterEach(async () => {
    await cron.stop();
  });

  it("invokes adapter.syncEvents with a window centered on now", async () => {
    const user = await createUser(db, { telegramId: "tg_gs_1" });
    let captured: DateRange | null = null;
    const adapter: SourceAdapter = {
      name: "gcal",
      authenticate: async () => {},
      pushUpdate: async () => {},
      syncEvents: async (_uid, range) => {
        captured = range;
        return [];
      },
    };
    cron.registerHandler(
      "gcal_sync",
      createGcalSyncHandler({ adapter, pastWindowMs: 1000, futureWindowMs: 2000 }),
    );
    const job = await createCronJob(db, {
      userId: user.id,
      kind: "gcal_sync",
      scheduleExpr: "@once",
      nextRunAt: new Date(),
    });
    await cron.runJob(job.id);
    expect(captured).not.toBeNull();
    if (!captured) throw new Error("not captured");
    const range = captured as DateRange;
    expect(range.end.getTime() - range.start.getTime()).toBe(3000);
  });

  it("end-to-end: handler runs adapter that upserts events into the db", async () => {
    const user = await createUser(db, { telegramId: "tg_gs_2" });
    const adapter: SourceAdapter = {
      name: "gcal",
      authenticate: async () => {},
      pushUpdate: async () => {},
      syncEvents: async (uid) => {
        const { createEvent } = await import("@lifeagent/db");
        const ev = await createEvent(db, {
          userId: uid,
          source: "gcal",
          externalId: "g_e2e",
          title: "synced",
          startAt: new Date(),
          endAt: new Date(Date.now() + 60_000),
        });
        return [{ kind: "upsert", event: ev }];
      },
    };
    cron.registerHandler("gcal_sync", createGcalSyncHandler({ adapter }));
    const job = await createCronJob(db, {
      userId: user.id,
      kind: "gcal_sync",
      scheduleExpr: "@once",
      nextRunAt: new Date(),
    });
    await cron.runJob(job.id);
    const stored = await getEventByExternalId(db, user.id, "gcal", "g_e2e");
    expect(stored?.title).toBe("synced");
  });
});
