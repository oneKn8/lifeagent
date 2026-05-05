import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  createEvent,
  createUser,
  getActiveCronJobsByEventId,
  getEventById,
  makeTestDb,
  updateEventStatus,
} from "@lifeagent/db";
import type { Brain, ChatChunk } from "../../brain/types";
import { CronScheduler } from "../cron";
import { HookBus } from "../hooks";
import { MemoryStore } from "../memory";
import { LifeAgentSDK } from "../sdk";
import { SkillLoader } from "../skills";
import { ToolRegistry } from "../tools";
import { createUpdateEventTool } from "./update_event";

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
  const skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-tool-update-event-"));
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

const FUTURE_START = new Date(Date.now() + 60 * 60_000); // 1h from now
const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60_000);

describe("update_event tool", () => {
  let db: Db;
  let sdk: LifeAgentSDK;
  let cleanup: () => Promise<void>;
  let reg: ToolRegistry;

  beforeEach(async () => {
    db = await makeTestDb();
    ({ sdk, cleanup } = await makeSdk(db));
    reg = new ToolRegistry();
    reg.register(createUpdateEventTool({ sdk }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("updates title and notes without touching cron schedules", async () => {
    const user = await createUser(db, { telegramId: "tg_upd_e_1" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "old",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    const beforeJobs = await getActiveCronJobsByEventId(db, eventId);
    const beforeIds = beforeJobs.map((j) => j.id).sort();

    await reg.dispatch(
      "update_event",
      { eventId, title: "new title", notes: "more context" },
      { userId: user.id },
    );

    const row = await getEventById(db, eventId);
    expect(row?.title).toBe("new title");
    expect(row?.notes).toBe("more context");

    const afterJobs = await getActiveCronJobsByEventId(db, eventId);
    expect(afterJobs.map((j) => j.id).sort()).toEqual(beforeIds);
  });

  it("reschedules pre_ping when startAt changes", async () => {
    const user = await createUser(db, { telegramId: "tg_upd_e_2" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });

    const newStart = new Date(FUTURE_START.getTime() + 30 * 60_000);
    await reg.dispatch(
      "update_event",
      { eventId, startAt: newStart.toISOString() },
      { userId: user.id },
    );

    const jobs = await getActiveCronJobsByEventId(db, eventId);
    const pre = jobs.find((j) => j.kind === "pre_ping");
    expect(pre).toBeDefined();
    expect(pre?.nextRunAt?.toISOString()).toBe(
      new Date(newStart.getTime() - 5 * 60_000).toISOString(),
    );

    const row = await getEventById(db, eventId);
    expect(row?.startAt.toISOString()).toBe(newStart.toISOString());
    expect(row?.prePingAt?.toISOString()).toBe(
      new Date(newStart.getTime() - 5 * 60_000).toISOString(),
    );

    // Exactly one active pre_ping for this event (no leftover from old schedule)
    expect(jobs.filter((j) => j.kind === "pre_ping")).toHaveLength(1);
  });

  it("reschedules post_ping when endAt changes", async () => {
    const user = await createUser(db, { telegramId: "tg_upd_e_3" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "study",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });

    const newEnd = new Date(FUTURE_END.getTime() + 30 * 60_000);
    await reg.dispatch(
      "update_event",
      { eventId, endAt: newEnd.toISOString() },
      { userId: user.id },
    );

    const jobs = await getActiveCronJobsByEventId(db, eventId);
    const post = jobs.find((j) => j.kind === "post_ping");
    expect(post?.nextRunAt?.toISOString()).toBe(newEnd.toISOString());
    expect(jobs.filter((j) => j.kind === "post_ping")).toHaveLength(1);

    const row = await getEventById(db, eventId);
    expect(row?.endAt.toISOString()).toBe(newEnd.toISOString());
    expect(row?.postPingAt?.toISOString()).toBe(newEnd.toISOString());
  });

  it("does not re-schedule a ping that has already been sent", async () => {
    const user = await createUser(db, { telegramId: "tg_upd_e_4" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lifted already",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await updateEventStatus(db, eventId, "planned", { prePingSentAt: new Date() });

    const newStart = new Date(FUTURE_START.getTime() + 30 * 60_000);
    await reg.dispatch(
      "update_event",
      { eventId, startAt: newStart.toISOString() },
      { userId: user.id },
    );

    const jobs = await getActiveCronJobsByEventId(db, eventId, "pre_ping");
    expect(jobs).toHaveLength(0);

    // post_ping is untouched (since endAt didn't change)
    const postJobs = await getActiveCronJobsByEventId(db, eventId, "post_ping");
    expect(postJobs).toHaveLength(1);
  });

  it("rejects updates to events with non-manual source", async () => {
    const user = await createUser(db, { telegramId: "tg_upd_e_5" });
    const ev = await createEvent(db, {
      userId: user.id,
      source: "gcal",
      title: "external",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await expect(
      reg.dispatch("update_event", { eventId: ev.id, title: "renamed" }, { userId: user.id }),
    ).rejects.toThrow(/manual/i);
  });

  it("rejects updates to events that belong to another user", async () => {
    const owner = await createUser(db, { telegramId: "tg_upd_e_6a" });
    const stranger = await createUser(db, { telegramId: "tg_upd_e_6b" });
    const { eventId } = await sdk.addManualEvent({
      userId: owner.id,
      title: "mine",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await expect(
      reg.dispatch("update_event", { eventId, title: "yours now" }, { userId: stranger.id }),
    ).rejects.toThrow();
  });

  it("rejects when no fields are supplied", async () => {
    const user = await createUser(db, { telegramId: "tg_upd_e_7" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "x",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await expect(reg.dispatch("update_event", { eventId }, { userId: user.id })).rejects.toThrow();
  });
});
