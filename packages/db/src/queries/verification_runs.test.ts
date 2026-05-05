import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import { createEvent } from "./events";
import { createUser } from "./users";
import {
  getVerificationsForEvent,
  recordVerificationRun,
} from "./verification_runs";

describe("verification_runs queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("recordVerificationRun stores a run with evidence", async () => {
    const user = await createUser(db, { telegramId: "tg_v1" });
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Run",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    const run = await recordVerificationRun(db, {
      userId: user.id,
      eventId: ev.id,
      verifier: "strava",
      consistent: true,
      confidence: 0.9,
      summary: "matched activity",
      evidence: { activityId: 123 },
    });
    expect(run.id).toBeDefined();
    expect(run.verifier).toBe("strava");
    expect(run.consistent).toBe(true);
    expect(run.confidence).toBe(0.9);
    expect(run.evidence).toEqual({ activityId: 123 });
  });

  it("getVerificationsForEvent returns all runs for that event newest first", async () => {
    const user = await createUser(db, { telegramId: "tg_v2" });
    const ev = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Walk",
      startAt: new Date("2026-05-04T10:00:00Z"),
      endAt: new Date("2026-05-04T11:00:00Z"),
    });
    const otherEv = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "Other",
      startAt: new Date("2026-05-04T12:00:00Z"),
      endAt: new Date("2026-05-04T13:00:00Z"),
    });
    await recordVerificationRun(db, {
      userId: user.id,
      eventId: ev.id,
      verifier: "strava",
      consistent: false,
    });
    await new Promise((r) => setTimeout(r, 5));
    await recordVerificationRun(db, {
      userId: user.id,
      eventId: ev.id,
      verifier: "calendar",
      consistent: true,
    });
    await recordVerificationRun(db, {
      userId: user.id,
      eventId: otherEv.id,
      verifier: "strava",
      consistent: true,
    });

    const rows = await getVerificationsForEvent(db, ev.id);
    expect(rows.length).toBe(2);
    expect(rows[0]?.verifier).toBe("calendar");
    expect(rows[1]?.verifier).toBe("strava");
  });
});
