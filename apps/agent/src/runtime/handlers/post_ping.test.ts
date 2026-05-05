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

describe("post_ping handler", () => {
  let db: Db;
  let skillsDir: string;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-post-ping-"));
    await writeFile(
      join(skillsDir, "lifeagent.md"),
      "---\nname: lifeagent\ndescription: persona\ntype: persona\ntriggers: [post_ping]\n---\nPost-ping persona.\n",
    );
  });

  afterEach(async () => {
    await cron?.stop();
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("sends post-ping and marks post_ping_sent_at", async () => {
    const user = await createUser(db, { telegramId: "tg_post_1" });

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
          input: { text: "lift just ended — done, partial, skipped, slipped?" },
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

    const handler = createPostPingHandler({ db, loop, skills, memory });
    cron.registerHandler("post_ping", handler);

    const [postJob] = await getActiveCronJobsByEventId(db, eventId, "post_ping");
    if (!postJob) throw new Error("no post-ping job");
    const result = await cron.runJob(postJob.id);
    expect(result).toBe("fired");

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.text.toLowerCase()).toContain("done");

    const after = await getEventById(db, eventId);
    expect(after?.postPingSentAt).toBeInstanceOf(Date);

    const msgs = await recentMessages(db, user.id, 5);
    expect(msgs.some((m) => m.relatedEventId === eventId)).toBe(true);
  });
});
