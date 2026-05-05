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
  updateEventStatus,
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
import { createEscalationHandler, scheduleEscalations } from "./escalation";
import { createInboundReplyHandler } from "./inbound_reply";
import { createPostPingHandler } from "./post_ping";

class ScriptedBrain implements Brain {
  constructor(private readonly turns: ChatChunk[][]) {}
  chat(_: ChatInput): AsyncIterable<ChatChunk> {
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

describe("escalation ladder", () => {
  let db: Db;
  let skillsDir: string;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-esc-"));
    await writeFile(
      join(skillsDir, "lifeagent.md"),
      "---\nname: lifeagent\ndescription: persona\ntype: persona\ntriggers: []\n---\nbody\n",
    );
  });

  afterEach(async () => {
    await cron?.stop();
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("post-ping handler schedules three escalations after sending", async () => {
    const user = await createUser(db, { telegramId: "tg_esc_1" });

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
          input: { text: "did you finish?" },
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

    cron.registerHandler("post_ping", createPostPingHandler({ db, loop, skills, memory, cron }));
    const [postJob] = await getActiveCronJobsByEventId(db, eventId, "post_ping");
    if (!postJob) throw new Error("no post-ping job");
    await cron.runJob(postJob.id);

    const escalations = await getActiveCronJobsByEventId(db, eventId, "escalation");
    expect(escalations).toHaveLength(3);
    const attempts = escalations.map((j) => (j.payload as { attempt: number }).attempt).sort();
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("escalation handler no-ops if user has already replied", async () => {
    const user = await createUser(db, { telegramId: "tg_esc_2" });

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
    const brain = new ScriptedBrain([]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await updateEventStatus(db, eventId, "done", {
      postPingSentAt: new Date(),
      userReplyText: "done",
    });

    cron.registerHandler("escalation", createEscalationHandler({ db, loop, skills }));
    const ids = await scheduleEscalations({ cron, userId: user.id, eventId });
    const firstId = ids[0];
    if (!firstId) throw new Error("no escalation");
    const result = await cron.runJob(firstId);
    expect(result).toBe("fired");
    expect(api.sent).toHaveLength(0);
  });

  it("inbound reply cancels pending escalation jobs", async () => {
    const user = await createUser(db, { telegramId: "tg_esc_3" });
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
    const brain = new ScriptedBrain([]);
    const sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });

    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await updateEventStatus(db, eventId, "planned", { postPingSentAt: new Date() });
    await scheduleEscalations({ cron, userId: user.id, eventId });
    expect((await getActiveCronJobsByEventId(db, eventId, "escalation")).length).toBe(3);

    // brain returns parsed { status: "done" }
    const stubBrain = {
      chat() {
        return {
          async *[Symbol.asyncIterator]() {
            yield await Promise.resolve({ type: "stop" as const, reason: "end" });
          },
        };
      },
      async parseStructured<T>() {
        return { status: "done" } as T;
      },
    };
    const handle = createInboundReplyHandler({ db, brain: stubBrain });
    await handle({ userId: user.id, text: "done" });

    const remaining = await getActiveCronJobsByEventId(db, eventId, "escalation");
    expect(remaining).toHaveLength(0);

    const after = await getEventById(db, eventId);
    expect(after?.status).toBe("done");
  });

  it("third escalation pings the accountability contact when configured", async () => {
    const user = await createUser(db, { telegramId: "tg_esc_4" });
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
          input: { text: "30 min, no reply. Yes/no?" },
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
      title: "ship",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await updateEventStatus(db, eventId, "planned", { postPingSentAt: new Date() });

    cron.registerHandler(
      "escalation",
      createEscalationHandler({
        db,
        loop,
        skills,
        adapter,
        accountabilityChatId: 9999,
      }),
    );
    const ids = await scheduleEscalations({ cron, userId: user.id, eventId });
    const thirdId = ids[2];
    if (!thirdId) throw new Error("no third escalation id");
    await cron.runJob(thirdId);

    // Two outbound calls: one to ownerId via send_message, one to accountabilityChatId
    expect(api.sent.length).toBeGreaterThanOrEqual(1);
    const accountability = api.sent.find((c) => c.chatId === 9999);
    expect(accountability?.text).toContain("ship");
  });
});
