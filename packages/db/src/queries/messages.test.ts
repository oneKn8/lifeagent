import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import { appendMessage, recentMessages } from "./messages";
import { createUser } from "./users";

describe("messages queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("appendMessage stores a message and returns the row", async () => {
    const user = await createUser(db, { telegramId: "tg_m1" });
    const msg = await appendMessage(db, {
      userId: user.id,
      role: "user",
      channel: "telegram",
      content: "hello",
    });
    expect(msg.id).toBeDefined();
    expect(msg.content).toBe("hello");
    expect(msg.role).toBe("user");
    expect(msg.channel).toBe("telegram");
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  it("recentMessages returns newest first up to limit", async () => {
    const user = await createUser(db, { telegramId: "tg_m2" });
    for (const text of ["a", "b", "c", "d"]) {
      await appendMessage(db, {
        userId: user.id,
        role: "user",
        channel: "telegram",
        content: text,
      });
      // Small wait to differentiate timestamps
      await new Promise((r) => setTimeout(r, 5));
    }
    const rows = await recentMessages(db, user.id, 2);
    expect(rows.length).toBe(2);
    expect(rows[0]?.content).toBe("d");
    expect(rows[1]?.content).toBe("c");
  });

  it("recentMessages only returns messages for the requested user", async () => {
    const u1 = await createUser(db, { telegramId: "tg_m3" });
    const u2 = await createUser(db, { telegramId: "tg_m4" });
    await appendMessage(db, {
      userId: u1.id,
      role: "user",
      channel: "telegram",
      content: "u1-msg",
    });
    await appendMessage(db, {
      userId: u2.id,
      role: "user",
      channel: "telegram",
      content: "u2-msg",
    });
    const rows = await recentMessages(db, u1.id, 10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.content).toBe("u1-msg");
  });
});
