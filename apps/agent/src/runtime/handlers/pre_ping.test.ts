import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  cancelCronJob,
  createCronJob,
  createUser,
  getActiveCronJobsByEventId,
  getEventById,
  makeTestDb,
  recentMessages,
} from "@lifeagent/db";
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
import { createPrePingHandler } from "./pre_ping";

class ScriptedBrain implements Brain {
  public lastInput: ChatInput | null = null;
  constructor(private readonly turns: ChatChunk[][]) {}
  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    this.lastInput = input;
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

describe("pre_ping handler", () => {
  let db: Db;
  let skillsDir: string;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-pre-ping-"));
    await writeFile(
      join(skillsDir, "lifeagent.md"),
      "---\nname: lifeagent\ndescription: persona\ntype: persona\ntriggers: [pre_ping]\n---\nPre-ping persona.\n",
    );
  });

  afterEach(async () => {
    await cron?.stop();
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("sends pre-ping message via send_message tool and marks pre_ping_sent_at", async () => {
    const user = await createUser(db, { telegramId: "tg_pp_1" });

    const api = makeFakeApi();
    const adapter = new TelegramAdapter({
      token: "t",
      ownerId: 100,
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

    // Brain emits a tool_call for send_message, then stops.
    const brain = new ScriptedBrain([
      [
        {
          type: "tool_call",
          id: "c1",
          name: "send_message",
          input: { text: "lift in 5 — same plan as yesterday?" },
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

    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
      notes: "5x5 squats",
    });

    const handler = createPrePingHandler({ db, loop, skills, memory });
    cron.registerHandler("pre_ping", handler);

    const jobs = await getActiveCronJobsByEventId(db, eventId, "pre_ping");
    const preJob = jobs[0];
    expect(preJob).toBeDefined();
    if (!preJob) throw new Error("no pre-ping job seeded");

    const result = await cron.runJob(preJob.id);
    expect(result).toBe("fired");

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.text).toContain("lift");

    const after = await getEventById(db, eventId);
    expect(after?.prePingSentAt).toBeInstanceOf(Date);

    const msgs = await recentMessages(db, user.id, 5);
    expect(msgs.some((m) => m.relatedEventId === eventId && m.role === "assistant")).toBe(true);
  });

  it("is idempotent: a second fire does not re-send if pre_ping_sent_at is already set", async () => {
    const user = await createUser(db, { telegramId: "tg_pp_2" });

    const api = makeFakeApi();
    const adapter = new TelegramAdapter({
      token: "t",
      ownerId: 100,
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
          input: { text: "first" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text", text: "" },
        { type: "stop", reason: "end" },
      ],
      [
        {
          type: "tool_call",
          id: "c2",
          name: "send_message",
          input: { text: "second" },
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

    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });

    const handler = createPrePingHandler({ db, loop, skills, memory });
    cron.registerHandler("pre_ping", handler);
    const [preJob] = await getActiveCronJobsByEventId(db, eventId, "pre_ping");
    if (!preJob) throw new Error("no pre-ping job seeded");

    await cron.runJob(preJob.id);
    expect(api.sent).toHaveLength(1);

    // Cancel and create a fresh job to retry
    await cancelCronJob(db, preJob.id);
    const reJob = await createCronJob(db, {
      userId: user.id,
      kind: "pre_ping",
      scheduleExpr: "@once",
      nextRunAt: new Date(),
      payload: { eventId },
    });
    await cron.runJob(reJob.id);
    expect(api.sent).toHaveLength(1); // still one — idempotent

    const after = await getEventById(db, eventId);
    expect(after?.prePingSentAt).toBeInstanceOf(Date);
  });
});
