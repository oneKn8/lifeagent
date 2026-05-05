import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, createUser, getEventById, makeTestDb } from "@lifeagent/db";
import type { Brain, ChatChunk } from "../../brain/types";
import { CronScheduler } from "../cron";
import { HookBus } from "../hooks";
import { MemoryStore } from "../memory";
import { LifeAgentSDK } from "../sdk";
import { SkillLoader } from "../skills";
import { ToolRegistry } from "../tools";
import { createMarkEventStatusTool } from "./mark_event_status";

class NullBrain implements Brain {
  chat(): AsyncIterable<ChatChunk> {
    return {
      async *[Symbol.asyncIterator]() {
        yield await Promise.resolve({ type: "stop" as const, reason: "end" });
      },
    };
  }
  async parseStructured<T>(): Promise<T> {
    throw new Error("not implemented");
  }
}

async function makeSdk(db: Db): Promise<{ sdk: LifeAgentSDK; cleanup: () => Promise<void> }> {
  const skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-tool-mark-status-"));
  await writeFile(
    join(skillsDir, "lifeagent.md"),
    "---\nname: lifeagent\ndescription: persona\ntype: persona\ntriggers: []\n---\nbody\n",
  );
  const hooks = new HookBus();
  const tools = new ToolRegistry();
  const memory = new MemoryStore(db);
  const skills = new SkillLoader({ skillsDir });
  await skills.loadAll();
  const cron = new CronScheduler({ db, hooks });
  const sdk = new LifeAgentSDK({
    db,
    brain: new NullBrain(),
    tools,
    hooks,
    skills,
    cron,
    memory,
  });
  return {
    sdk,
    cleanup: async () => {
      await sdk.stop();
      await rm(skillsDir, { recursive: true, force: true });
    },
  };
}

const FUTURE_START = new Date(Date.now() + 60 * 60_000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60_000);

describe("mark_event_status tool", () => {
  let db: Db;
  let sdk: LifeAgentSDK;
  let cleanup: () => Promise<void>;
  let reg: ToolRegistry;

  beforeEach(async () => {
    db = await makeTestDb();
    ({ sdk, cleanup } = await makeSdk(db));
    reg = new ToolRegistry();
    reg.register(createMarkEventStatusTool({ sdk }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("marks status=done with userReplyText", async () => {
    const user = await createUser(db, { telegramId: "tg_mark_1" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });

    await reg.dispatch(
      "mark_event_status",
      { eventId, status: "done", userReplyText: "did 5x5 squats" },
      { userId: user.id },
    );

    const row = await getEventById(db, eventId);
    expect(row?.status).toBe("done");
    expect(row?.userReplyText).toBe("did 5x5 squats");
  });

  it("supports all status values: done | partial | skipped | slipped", async () => {
    const user = await createUser(db, { telegramId: "tg_mark_2" });
    for (const status of ["done", "partial", "skipped", "slipped"] as const) {
      const { eventId } = await sdk.addManualEvent({
        userId: user.id,
        title: status,
        startAt: new Date(FUTURE_START.getTime() + Math.random() * 60_000),
        endAt: new Date(FUTURE_END.getTime() + Math.random() * 60_000),
      });
      await reg.dispatch("mark_event_status", { eventId, status }, { userId: user.id });
      const row = await getEventById(db, eventId);
      expect(row?.status).toBe(status);
    }
  });

  it("rejects an invalid status value", async () => {
    const user = await createUser(db, { telegramId: "tg_mark_3" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "x",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await expect(
      reg.dispatch("mark_event_status", { eventId, status: "complete" }, { userId: user.id }),
    ).rejects.toThrow();
  });

  it("rejects events that belong to another user", async () => {
    const owner = await createUser(db, { telegramId: "tg_mark_4a" });
    const stranger = await createUser(db, { telegramId: "tg_mark_4b" });
    const { eventId } = await sdk.addManualEvent({
      userId: owner.id,
      title: "mine",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await expect(
      reg.dispatch("mark_event_status", { eventId, status: "done" }, { userId: stranger.id }),
    ).rejects.toThrow();
  });

  it("rejects unknown event ids", async () => {
    const user = await createUser(db, { telegramId: "tg_mark_5" });
    await expect(
      reg.dispatch(
        "mark_event_status",
        { eventId: "00000000-0000-0000-0000-000000000000", status: "done" },
        { userId: user.id },
      ),
    ).rejects.toThrow();
  });
});
