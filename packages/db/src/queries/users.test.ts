import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import { createUser, getUserByTelegramId } from "./users";

describe("users queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("createUser inserts a user with defaults and returns it", async () => {
    const user = await createUser(db, { telegramId: "tg_123" });
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(user.telegramId).toBe("tg_123");
    expect(user.email).toBeNull();
    expect(user.tz).toBe("America/Chicago");
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("createUser respects provided email and tz", async () => {
    const user = await createUser(db, {
      telegramId: "tg_456",
      email: "x@y.com",
      tz: "UTC",
    });
    expect(user.email).toBe("x@y.com");
    expect(user.tz).toBe("UTC");
  });

  it("getUserByTelegramId returns the matching user", async () => {
    const created = await createUser(db, { telegramId: "tg_lookup" });
    const found = await getUserByTelegramId(db, "tg_lookup");
    expect(found?.id).toBe(created.id);
    expect(found?.telegramId).toBe("tg_lookup");
  });

  it("getUserByTelegramId returns null when no match", async () => {
    const found = await getUserByTelegramId(db, "nope");
    expect(found).toBeNull();
  });
});
