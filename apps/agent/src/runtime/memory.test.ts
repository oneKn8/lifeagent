import { beforeEach, describe, expect, it } from "bun:test";
import { type Db, createUser, makeTestDb } from "@lifeagent/db";
import { MemoryStore } from "./memory";

describe("MemoryStore", () => {
  let db: Db;
  let store: MemoryStore;

  beforeEach(async () => {
    db = await makeTestDb();
    store = new MemoryStore(db);
  });

  it("adds and retrieves a fact", async () => {
    const user = await createUser(db, { telegramId: "tg_mem1" });
    const fact = await store.addFact({
      userId: user.id,
      kind: "preference",
      body: "likes cold brew",
    });
    expect(fact.id).toBeDefined();
    expect(fact.body).toBe("likes cold brew");
    expect(fact.kind).toBe("preference");

    const recent = await store.topRecent(user.id, 5);
    expect(recent.length).toBe(1);
    expect(recent[0]?.body).toBe("likes cold brew");
  });

  it("topRecent returns N most recent by last_used_at desc", async () => {
    const user = await createUser(db, { telegramId: "tg_mem2" });
    await store.addFact({
      userId: user.id,
      kind: "habit",
      body: "old",
      lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await store.addFact({
      userId: user.id,
      kind: "habit",
      body: "middle",
      lastUsedAt: new Date("2026-03-01T00:00:00Z"),
    });
    await store.addFact({
      userId: user.id,
      kind: "habit",
      body: "newest",
      lastUsedAt: new Date("2026-05-01T00:00:00Z"),
    });
    const top2 = await store.topRecent(user.id, 2);
    expect(top2.map((r) => r.body)).toEqual(["newest", "middle"]);
  });

  it("recall finds substring matches case-insensitively", async () => {
    const user = await createUser(db, { telegramId: "tg_mem3" });
    await store.addFact({ userId: user.id, kind: "context", body: "Loves Coffee" });
    await store.addFact({ userId: user.id, kind: "context", body: "dislikes tea" });
    const results = await store.recall(user.id, "coffee");
    expect(results.length).toBe(1);
    expect(results[0]?.body).toBe("Loves Coffee");
  });

  it("recall returns empty array when no matches", async () => {
    const user = await createUser(db, { telegramId: "tg_mem4" });
    await store.addFact({ userId: user.id, kind: "context", body: "Loves Coffee" });
    const results = await store.recall(user.id, "popcorn");
    expect(results).toEqual([]);
  });

  it("recall is scoped to the requesting user", async () => {
    const u1 = await createUser(db, { telegramId: "tg_mem5" });
    const u2 = await createUser(db, { telegramId: "tg_mem6" });
    await store.addFact({ userId: u1.id, kind: "context", body: "u1 fact about coffee" });
    await store.addFact({ userId: u2.id, kind: "context", body: "u2 fact about coffee" });
    const results = await store.recall(u1.id, "coffee");
    expect(results.length).toBe(1);
    expect(results[0]?.body).toBe("u1 fact about coffee");
  });
});
