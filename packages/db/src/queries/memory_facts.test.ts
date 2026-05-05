import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../client";
import { makeTestDb } from "../test-helpers";
import {
  addMemoryFact,
  searchMemoryFacts,
  topMemoryFacts,
} from "./memory_facts";
import { createUser } from "./users";

describe("memory_facts queries", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("addMemoryFact inserts a fact with defaults", async () => {
    const user = await createUser(db, { telegramId: "tg_mf1" });
    const fact = await addMemoryFact(db, {
      userId: user.id,
      kind: "preference",
      body: "likes oat milk",
    });
    expect(fact.id).toBeDefined();
    expect(fact.body).toBe("likes oat milk");
    expect(fact.confidence).toBe(1);
    expect(fact.kind).toBe("preference");
    expect(fact.lastUsedAt).toBeInstanceOf(Date);
  });

  it("topMemoryFacts returns most recently used first up to limit", async () => {
    const user = await createUser(db, { telegramId: "tg_mf2" });
    await addMemoryFact(db, {
      userId: user.id,
      kind: "habit",
      body: "old fact",
      lastUsedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await addMemoryFact(db, {
      userId: user.id,
      kind: "habit",
      body: "new fact",
      lastUsedAt: new Date("2026-05-01T00:00:00Z"),
    });
    const rows = await topMemoryFacts(db, user.id, 1);
    expect(rows.length).toBe(1);
    expect(rows[0]?.body).toBe("new fact");
  });

  it("searchMemoryFacts performs case-insensitive LIKE match scoped to user", async () => {
    const u1 = await createUser(db, { telegramId: "tg_mf3" });
    const u2 = await createUser(db, { telegramId: "tg_mf4" });
    await addMemoryFact(db, {
      userId: u1.id,
      kind: "context",
      body: "Loves Coffee",
    });
    await addMemoryFact(db, {
      userId: u1.id,
      kind: "context",
      body: "dislikes tea",
    });
    await addMemoryFact(db, {
      userId: u2.id,
      kind: "context",
      body: "loves coffee too",
    });

    const rows = await searchMemoryFacts(db, u1.id, "coffee");
    expect(rows.length).toBe(1);
    expect(rows[0]?.body).toBe("Loves Coffee");
  });
});
