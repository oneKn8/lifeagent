import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import {
  createEvent,
  getEventById,
  getEventsBySourceInRange,
  getEventsForDay,
  getUpcomingEventsNeedingPings,
  updateEvent,
  updateEventStatus,
} from "./events";
import { createUser } from "./users";

async function seedUser(db: Db, tg = "tg_e") {
  return await createUser(db, { telegramId: tg });
}

describe("events queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("createEvent inserts and returns full row with defaults", async () => {
    const user = await seedUser(db);
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Gym",
      startAt: new Date("2026-05-04T12:00:00Z"),
      endAt: new Date("2026-05-04T13:00:00Z"),
    });
    expect(ev.id).toBeDefined();
    expect(ev.title).toBe("Gym");
    expect(ev.status).toBe("planned");
    expect(ev.verificationStatus).toBe("pending");
    expect(ev.startAt).toBeInstanceOf(Date);
  });

  it("getEventById returns the event or null", async () => {
    const user = await seedUser(db);
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Read",
      startAt: new Date("2026-05-04T08:00:00Z"),
      endAt: new Date("2026-05-04T09:00:00Z"),
    });
    const found = await getEventById(db, ev.id);
    expect(found?.id).toBe(ev.id);

    const notFound = await getEventById(db, "00000000-0000-0000-0000-000000000000");
    expect(notFound).toBeNull();
  });

  it("getEventsForDay returns only events overlapping the given day in UTC", async () => {
    const user = await seedUser(db);
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Today",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Tomorrow",
      startAt: new Date("2026-05-05T10:00:00Z"),
      endAt: new Date("2026-05-05T11:00:00Z"),
    });

    const day = new Date("2026-05-04T00:00:00Z");
    const rows = await getEventsForDay(db, user.id, day);
    expect(rows.length).toBe(1);
    expect(rows[0]?.title).toBe("Today");
  });

  it("getEventsForDay excludes events starting at exactly next-day midnight (half-open interval)", async () => {
    const user = await seedUser(db);
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Boundary",
      startAt: new Date("2026-05-05T00:00:00Z"),
      endAt: new Date("2026-05-05T01:00:00Z"),
    });

    const day = new Date("2026-05-04T00:00:00Z");
    const rows = await getEventsForDay(db, user.id, day);
    expect(rows.length).toBe(0);
  });

  it("updateEventStatus sets status and optional fields", async () => {
    const user = await seedUser(db);
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Run",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    const updated = await updateEventStatus(db, ev.id, "done", {
      userReplyText: "did it",
      notes: "felt good",
    });
    expect(updated?.status).toBe("done");
    expect(updated?.userReplyText).toBe("did it");
    expect(updated?.notes).toBe("felt good");
  });

  it("getUpcomingEventsNeedingPings returns rows whose pre_ping_at is due and not sent", async () => {
    const user = await seedUser(db);
    const dueEvent = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Soon",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
      prePingAt: new Date("2026-05-04T14:50:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Later",
      startAt: new Date("2026-05-04T20:00:00Z"),
      endAt: new Date("2026-05-04T21:00:00Z"),
      prePingAt: new Date("2026-05-04T19:50:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "NoPing",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });

    const rows = await getUpcomingEventsNeedingPings(db, new Date("2026-05-04T15:00:00Z"));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(dueEvent.id);
    expect(rows.length).toBe(1);
  });

  it("updateEvent applies a partial patch and returns the updated row", async () => {
    const user = await seedUser(db, "tg_upd_1");
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "original",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    const updated = await updateEvent(db, ev.id, {
      title: "renamed",
      startAt: new Date("2026-05-04T09:00:00Z"),
      endAt: new Date("2026-05-04T10:00:00Z"),
      notes: "moved",
    });
    expect(updated?.title).toBe("renamed");
    expect(updated?.startAt.toISOString()).toBe("2026-05-04T09:00:00.000Z");
    expect(updated?.endAt.toISOString()).toBe("2026-05-04T10:00:00.000Z");
    expect(updated?.notes).toBe("moved");
  });

  it("updateEvent returns null for an unknown id", async () => {
    const result = await updateEvent(db, "00000000-0000-0000-0000-000000000000", {
      title: "x",
    });
    expect(result).toBeNull();
  });

  it("updateEvent can clear pre/post ping timestamps via null", async () => {
    const user = await seedUser(db, "tg_upd_2");
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "t",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
      prePingAt: new Date("2026-05-04T09:55:00Z"),
      postPingAt: new Date("2026-05-04T11:00:00Z"),
    });
    const cleared = await updateEvent(db, ev.id, { prePingAt: null, postPingAt: null });
    expect(cleared?.prePingAt).toBeNull();
    expect(cleared?.postPingAt).toBeNull();
  });

  it("getEventsBySourceInRange filters by source and start_at window", async () => {
    const user = await seedUser(db, "tg_src_filter");
    const wantedManual = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "wanted",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "gcal",
      title: "wrong source",
      startAt: new Date("2026-05-04T12:00:00Z"),
      endAt: new Date("2026-05-04T13:00:00Z"),
    });
    await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "out of range",
      startAt: new Date("2026-06-01T10:00:00Z"),
      endAt: new Date("2026-06-01T11:00:00Z"),
    });

    const rows = await getEventsBySourceInRange(db, user.id, "manual", {
      start: new Date("2026-05-04T00:00:00Z"),
      end: new Date("2026-05-05T00:00:00Z"),
    });
    expect(rows.map((r) => r.id)).toEqual([wantedManual.id]);
  });
});
