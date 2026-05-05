import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  createUser,
  getCronJobById,
  getEventById,
  makeTestDb,
  recentMessages,
} from "@lifeagent/db";
import type { Brain, ChatChunk, ChatInput } from "../brain/types";
import { CronScheduler } from "./cron";
import { HookBus } from "./hooks";
import { MemoryStore } from "./memory";
import { LifeAgentSDK } from "./sdk";
import { SkillLoader } from "./skills";
import { ToolRegistry } from "./tools";

function chunkStream(chunks: ChatChunk[]): AsyncIterable<ChatChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

class StubBrain implements Brain {
  public lastInput: ChatInput | null = null;
  constructor(private readonly turn: ChatChunk[]) {}
  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    this.lastInput = input;
    return chunkStream(this.turn);
  }
  async parseStructured<T>(): Promise<T> {
    throw new Error("not implemented in stub");
  }
}

async function makeSkillsTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lifeagent-sdk-"));
  await writeFile(
    join(dir, "lifeagent.md"),
    `---
name: lifeagent
description: core agent persona
type: persona
triggers: []
---

You are lifeagent. Be concise.
`,
  );
  return dir;
}

describe("LifeAgentSDK", () => {
  let db: Db;
  let skillsDir: string;
  let sdk: LifeAgentSDK;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    skillsDir = await makeSkillsTempDir();
    const hooks = new HookBus();
    const tools = new ToolRegistry();
    const memory = new MemoryStore(db);
    const skills = new SkillLoader({ skillsDir });
    await skills.loadAll();
    cron = new CronScheduler({ db, hooks });
    const brain = new StubBrain([
      { type: "text", text: "ok i hear you" },
      { type: "stop", reason: "end" },
    ]);
    sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });
  });

  afterEach(async () => {
    await sdk.stop();
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("submitUserMessage persists incoming message, runs loop, persists agent reply", async () => {
    const user = await createUser(db, { telegramId: "tg_sdk1" });
    const result = await sdk.submitUserMessage({
      userId: user.id,
      channel: "telegram",
      text: "hello",
    });
    expect(result.replyText).toBe("ok i hear you");

    const msgs = await recentMessages(db, user.id, 10);
    // Most recent first: agent reply, then user message
    expect(msgs.length).toBe(2);
    expect(msgs[0]?.role).toBe("agent");
    expect(msgs[0]?.content).toBe("ok i hear you");
    expect(msgs[1]?.role).toBe("user");
    expect(msgs[1]?.content).toBe("hello");
  });

  it("submitUserMessage system prompt includes the lifeagent skill body", async () => {
    const user = await createUser(db, { telegramId: "tg_sdk2" });
    const brain = new StubBrain([
      { type: "text", text: "yo" },
      { type: "stop", reason: "end" },
    ]);
    const hooks = new HookBus();
    const tools = new ToolRegistry();
    const memory = new MemoryStore(db);
    const skills = new SkillLoader({ skillsDir });
    await skills.loadAll();
    const sdk2 = new LifeAgentSDK({
      db,
      brain,
      tools,
      hooks,
      skills,
      cron: new CronScheduler({ db, hooks }),
      memory,
    });
    await sdk2.submitUserMessage({ userId: user.id, channel: "cli", text: "test" });
    expect(brain.lastInput?.system).toContain("You are lifeagent");
  });

  it("addManualEvent creates event with pre/post ping times set", async () => {
    const user = await createUser(db, { telegramId: "tg_sdk3" });
    const startAt = new Date("2026-05-04T18:00:00Z");
    const endAt = new Date("2026-05-04T19:00:00Z");
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "deep work",
      startAt,
      endAt,
      notes: "focus block",
    });
    const ev = await getEventById(db, eventId);
    expect(ev).not.toBeNull();
    expect(ev?.title).toBe("deep work");
    expect(ev?.source).toBe("manual");
    expect(ev?.prePingAt?.toISOString()).toBe(
      new Date(startAt.getTime() - 5 * 60_000).toISOString(),
    );
    expect(ev?.postPingAt?.toISOString()).toBe(endAt.toISOString());
  });

  it("addManualEvent: cron jobs fire with correct kind+payload when due", async () => {
    const user = await createUser(db, { telegramId: "tg_sdk4" });
    const startAt = new Date("2026-05-04T18:00:00Z");
    const endAt = new Date("2026-05-04T19:00:00Z");
    const fired: Array<{ kind: string; payload: unknown }> = [];
    cron.registerHandler("pre_ping", async (job) => {
      fired.push({ kind: job.kind, payload: job.payload });
    });
    cron.registerHandler("post_ping", async (job) => {
      fired.push({ kind: job.kind, payload: job.payload });
    });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "meeting",
      startAt,
      endAt,
    });
    // Tick well past both ping times
    const result = await cron.tickOnce(new Date("2026-05-04T20:00:00Z"));
    expect(result.fired).toBe(2);
    const kinds = fired.map((f) => f.kind).sort();
    expect(kinds).toEqual(["post_ping", "pre_ping"]);
    for (const f of fired) {
      expect(f.payload).toEqual({ eventId });
    }
  });

  it("getDayPlan returns events for the day", async () => {
    const user = await createUser(db, { telegramId: "tg_sdk5" });
    await sdk.addManualEvent({
      userId: user.id,
      title: "morning run",
      startAt: new Date("2026-05-04T13:00:00Z"),
      endAt: new Date("2026-05-04T14:00:00Z"),
    });
    await sdk.addManualEvent({
      userId: user.id,
      title: "tomorrow",
      startAt: new Date("2026-05-05T13:00:00Z"),
      endAt: new Date("2026-05-05T14:00:00Z"),
    });
    const plan = await sdk.getDayPlan(user.id, new Date("2026-05-04T00:00:00Z"));
    expect(plan.length).toBe(1);
    expect(plan[0]?.title).toBe("morning run");
  });

  it("runCron manually fires a specific job by id", async () => {
    const user = await createUser(db, { telegramId: "tg_sdk6" });
    let calls = 0;
    cron.registerHandler("verify", async () => {
      calls += 1;
    });
    const { id } = await cron.schedule({
      userId: user.id,
      kind: "verify",
      nextRunAt: new Date("2099-01-01T00:00:00Z"), // far future, would not fire on tick
    });
    await sdk.runCron(id);
    expect(calls).toBe(1);
    const row = await getCronJobById(db, id);
    expect(row?.lastRunAt).toBeInstanceOf(Date);
  });
});
