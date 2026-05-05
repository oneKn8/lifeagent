import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import { getIntegration, upsertIntegration } from "./integrations";
import { createUser } from "./users";

describe("integrations queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("upsertIntegration inserts a new row when none exists", async () => {
    const user = await createUser(db, { telegramId: "tg_i1" });
    const row = await upsertIntegration(db, {
      userId: user.id,
      kind: "gcal",
      credentialsEncrypted: "abc",
      scopes: ["read"],
    });
    expect(row.kind).toBe("gcal");
    expect(row.credentialsEncrypted).toBe("abc");
    expect(row.status).toBe("active");
    expect(row.scopes).toEqual(["read"]);
  });

  it("upsertIntegration updates an existing user+kind row", async () => {
    const user = await createUser(db, { telegramId: "tg_i2" });
    const first = await upsertIntegration(db, {
      userId: user.id,
      kind: "strava",
      credentialsEncrypted: "v1",
    });
    const second = await upsertIntegration(db, {
      userId: user.id,
      kind: "strava",
      credentialsEncrypted: "v2",
      status: "paused",
    });
    expect(second.id).toBe(first.id);
    expect(second.credentialsEncrypted).toBe("v2");
    expect(second.status).toBe("paused");
  });

  it("getIntegration returns the row or null", async () => {
    const user = await createUser(db, { telegramId: "tg_i3" });
    await upsertIntegration(db, {
      userId: user.id,
      kind: "github",
      credentialsEncrypted: "tok",
    });
    const found = await getIntegration(db, user.id, "github");
    expect(found?.credentialsEncrypted).toBe("tok");

    const missing = await getIntegration(db, user.id, "wakatime");
    expect(missing).toBeNull();
  });
});
