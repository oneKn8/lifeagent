import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  createUser,
  getActiveCronJobsByEventId,
  getEventById,
  makeTestDb,
} from "@lifeagent/db";
import type { Brain, ChatChunk } from "../../brain/types";
import { CronScheduler } from "../cron";
import { HookBus } from "../hooks";
import { MemoryStore } from "../memory";
import { LifeAgentSDK } from "../sdk";
import { SkillLoader } from "../skills";
import { ToolRegistry } from "../tools";
import { createAddEventTool } from "./add_event";

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
  const skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-tool-add-event-"));
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

describe("add_event tool", () => {
  let db: Db;
  let sdk: LifeAgentSDK;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    db = await makeTestDb();
    ({ sdk, cleanup } = await makeSdk(db));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates a manual event row with the supplied fields", async () => {
    const user = await createUser(db, { telegramId: "tg_add_1" });
    const reg = new ToolRegistry();
    reg.register(createAddEventTool({ sdk }));

    const startAt = new Date("2026-05-04T15:00:00Z");
    const endAt = new Date("2026-05-04T16:00:00Z");
    const result = (await reg.dispatch(
      "add_event",
      {
        title: "deep work",
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: "manual",
        notes: "draft the spec",
      },
      { userId: user.id },
    )) as { eventId: string };

    expect(result.eventId).toBeDefined();
    const row = await getEventById(db, result.eventId);
    expect(row?.title).toBe("deep work");
    expect(row?.source).toBe("manual");
    expect(row?.notes).toBe("draft the spec");
    expect(row?.startAt.toISOString()).toBe(startAt.toISOString());
    expect(row?.endAt.toISOString()).toBe(endAt.toISOString());
  });

  it("schedules pre_ping at startAt-5min and post_ping at endAt with eventId payload", async () => {
    const user = await createUser(db, { telegramId: "tg_add_2" });
    const reg = new ToolRegistry();
    reg.register(createAddEventTool({ sdk }));

    const startAt = new Date("2026-05-04T15:00:00Z");
    const endAt = new Date("2026-05-04T16:00:00Z");
    const { eventId } = (await reg.dispatch(
      "add_event",
      {
        title: "lift",
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: "manual",
      },
      { userId: user.id },
    )) as { eventId: string };

    const jobs = await getActiveCronJobsByEventId(db, eventId);

    const byKind = new Map(jobs.map((j) => [j.kind, j]));
    expect(byKind.size).toBe(2);

    const pre = byKind.get("pre_ping");
    const post = byKind.get("post_ping");
    expect(pre).toBeDefined();
    expect(post).toBeDefined();

    expect(pre?.nextRunAt?.toISOString()).toBe(
      new Date(startAt.getTime() - 5 * 60_000).toISOString(),
    );
    expect(post?.nextRunAt?.toISOString()).toBe(endAt.toISOString());

    expect((pre?.payload as { eventId: string }).eventId).toBe(eventId);
    expect((post?.payload as { eventId: string }).eventId).toBe(eventId);
  });

  it("rejects non-manual source in v0", async () => {
    const user = await createUser(db, { telegramId: "tg_add_3" });
    const reg = new ToolRegistry();
    reg.register(createAddEventTool({ sdk }));

    await expect(
      reg.dispatch(
        "add_event",
        {
          title: "from gcal",
          startAt: new Date("2026-05-04T15:00:00Z").toISOString(),
          endAt: new Date("2026-05-04T16:00:00Z").toISOString(),
          source: "gcal",
        },
        { userId: user.id },
      ),
    ).rejects.toThrow();
  });

  it("rejects endAt before startAt", async () => {
    const user = await createUser(db, { telegramId: "tg_add_4" });
    const reg = new ToolRegistry();
    reg.register(createAddEventTool({ sdk }));

    await expect(
      reg.dispatch(
        "add_event",
        {
          title: "bad times",
          startAt: new Date("2026-05-04T16:00:00Z").toISOString(),
          endAt: new Date("2026-05-04T15:00:00Z").toISOString(),
          source: "manual",
        },
        { userId: user.id },
      ),
    ).rejects.toThrow();
  });
});
