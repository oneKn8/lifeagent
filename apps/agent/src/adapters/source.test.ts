import { beforeEach, describe, expect, it } from "bun:test";
import { type Db, createEvent, createUser, getEventById, makeTestDb } from "@lifeagent/db";
import { ManualAdapter } from "./source";

describe("ManualAdapter", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("identifies itself as 'manual'", () => {
    const adapter = new ManualAdapter(db);
    expect(adapter.name).toBe("manual");
  });

  it("authenticate is a no-op (manual entry has no oauth)", async () => {
    const adapter = new ManualAdapter(db);
    await expect(adapter.authenticate("any-user")).resolves.toBeUndefined();
  });

  it("syncEvents returns only events with source=manual within the date range", async () => {
    const user = await createUser(db, { telegramId: "tg_src_1" });
    const inRangeManual = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "in-range manual",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "gcal",
      title: "in-range gcal",
      startAt: new Date("2026-05-04T12:00:00Z"),
      endAt: new Date("2026-05-04T13:00:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "out-of-range manual",
      startAt: new Date("2026-06-01T10:00:00Z"),
      endAt: new Date("2026-06-01T11:00:00Z"),
    });

    const adapter = new ManualAdapter(db);
    const deltas = await adapter.syncEvents(user.id, {
      start: new Date("2026-05-04T00:00:00Z"),
      end: new Date("2026-05-05T00:00:00Z"),
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.event.id).toBe(inRangeManual.id);
    expect(deltas[0]?.kind).toBe("upsert");
  });

  it("pushUpdate applies a patch to an existing manual event", async () => {
    const user = await createUser(db, { telegramId: "tg_src_2" });
    const original = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "original",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });

    const adapter = new ManualAdapter(db);
    await adapter.pushUpdate(user.id, original.id, {
      title: "renamed",
      notes: "moved earlier",
      startAt: new Date("2026-05-04T09:00:00Z"),
      endAt: new Date("2026-05-04T10:00:00Z"),
    });

    const updated = await getEventById(db, original.id);
    expect(updated?.title).toBe("renamed");
    expect(updated?.notes).toBe("moved earlier");
    expect(updated?.startAt.toISOString()).toBe("2026-05-04T09:00:00.000Z");
    expect(updated?.endAt.toISOString()).toBe("2026-05-04T10:00:00.000Z");
  });

  it("pushUpdate refuses to modify events from other sources", async () => {
    const user = await createUser(db, { telegramId: "tg_src_3" });
    const gcal = await createEvent(db, {
      userId: user.id,
      source: "gcal",
      title: "do not touch",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });

    const adapter = new ManualAdapter(db);
    await expect(adapter.pushUpdate(user.id, gcal.id, { title: "hacked" })).rejects.toThrow(
      /manual/i,
    );

    const after = await getEventById(db, gcal.id);
    expect(after?.title).toBe("do not touch");
  });
});
