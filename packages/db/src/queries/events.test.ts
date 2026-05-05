import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import {
  createEvent,
  getEventById,
  getEventsForDay,
  getUpcomingEventsNeedingPings,
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
});
