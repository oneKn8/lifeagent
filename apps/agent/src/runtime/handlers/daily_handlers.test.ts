import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, createCronJob, createUser, makeTestDb, recentMessages } from "@lifeagent/db";
import { TelegramAdapter } from "../../adapters/telegram";
import type { Brain, ChatChunk, ChatInput } from "../../brain/types";
import { CronScheduler } from "../cron";
import { HookBus } from "../hooks";
import { AgentLoop } from "../loop";
import { MemoryStore } from "../memory";
import { LifeAgentSDK } from "../sdk";
import { SkillLoader } from "../skills";
import { ToolRegistry } from "../tools";
import { createSendMessageTool } from "../tools/send_message";
import { createMorningBriefHandler } from "./morning_brief";
import { createNightlySummaryHandler } from "./nightly_summary";

class ScriptedBrain implements Brain {
  public lastSystem: string | null = null;
  constructor(private readonly turns: ChatChunk[][]) {}
  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    this.lastSystem = input.system;
    const chunks = this.turns.shift() ?? [{ type: "stop" as const, reason: "end" }];
    return {
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
      },
    };
  }
  async parseStructured<T>(): Promise<T> {
    throw new Error("not used");
  }
}

function makeFakeApi() {
  const sent: Array<{ chatId: number | string; text: string }> = [];
  return {
    sent,
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
    },
  };
}

const FUTURE_START = new Date(Date.now() + 60 * 60_000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60_000);

describe("daily handlers", () => {
  let db: Db;
  let skillsDir: string;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-daily-"));
    await writeFile(
      join(skillsDir, "lifeagent.md"),
      "---\nname: lifeagent\ndescription: persona\ntype: persona\ntriggers: []\n---\nbody\n",
    );
    await writeFile(
      join(skillsDir, "daily-brief.md"),
      "---\nname: daily-brief\ndescription: brief\ntype: generator\ntriggers: [daily_brief]\n---\nWrite the morning brief.\n",
    );
    await writeFile(
      join(skillsDir, "daily-summary.md"),
      "---\nname: daily-summary\ndescription: summary\ntype: generator\ntriggers: [daily_summary]\n---\nWrite the nightly summary.\n",
    );
  });

  afterEach(async () => {
    await cron?.stop();
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("morning_brief handler builds a prompt with today's events and sends one message", async () => {
    const user = await createUser(db, { telegramId: "tg_brief_1" });

    const api = makeFakeApi();
    const adapter = new TelegramAdapter({
      token: "t",
      ownerId: 1,
      onMessage: () => {},
      api,
    });
    const tools = new ToolRegistry();
    tools.register(createSendMessageTool({ adapter, db }));

    const hooks = new HookBus();
    const skills = new SkillLoader({ skillsDir });
    await skills.loadAll();
    const memory = new MemoryStore(db);
    cron = new CronScheduler({ db, hooks });

    const brain = new ScriptedBrain([
      [
        {
          type: "tool_call",
          id: "c1",
          name: "send_message",
          input: { text: "today: lift, study" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text", text: "" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });

    await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });

    cron.registerHandler("morning_brief", createMorningBriefHandler({ db, loop, skills, memory }));
    const job = await createCronJob(db, {
      userId: user.id,
      kind: "morning_brief",
      scheduleExpr: "@once",
      nextRunAt: new Date(),
    });
    await cron.runJob(job.id);

    expect(api.sent).toHaveLength(1);
    expect(brain.lastSystem ?? "").toContain("lift");
  });

  it("nightly_summary handler includes today + tomorrow", async () => {
    const user = await createUser(db, { telegramId: "tg_summary_1" });

    const api = makeFakeApi();
    const adapter = new TelegramAdapter({
      token: "t",
      ownerId: 1,
      onMessage: () => {},
      api,
    });
    const tools = new ToolRegistry();
    tools.register(createSendMessageTool({ adapter, db }));

    const hooks = new HookBus();
    const skills = new SkillLoader({ skillsDir });
    await skills.loadAll();
    const memory = new MemoryStore(db);
    cron = new CronScheduler({ db, hooks });

    const brain = new ScriptedBrain([
      [
        {
          type: "tool_call",
          id: "c1",
          name: "send_message",
          input: { text: "today: done. tomorrow: lift." },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text", text: "" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });

    await sdk.addManualEvent({
      userId: user.id,
      title: "lift tomorrow",
      startAt: new Date(Date.now() + 24 * 60 * 60_000 + 60 * 60_000),
      endAt: new Date(Date.now() + 24 * 60 * 60_000 + 2 * 60 * 60_000),
    });

    cron.registerHandler(
      "nightly_summary",
      createNightlySummaryHandler({ db, loop, skills, memory }),
    );
    const job = await createCronJob(db, {
      userId: user.id,
      kind: "nightly_summary",
      scheduleExpr: "@once",
      nextRunAt: new Date(),
    });
    await cron.runJob(job.id);

    expect(api.sent).toHaveLength(1);
    expect(brain.lastSystem ?? "").toContain("Tomorrow");
    expect(brain.lastSystem ?? "").toContain("lift tomorrow");
  });
});
