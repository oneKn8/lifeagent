import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  createUser,
  getEventById,
  makeTestDb,
  recentMessages,
  updateEventStatus,
} from "@lifeagent/db";
import type { ZodType } from "zod";
import type { Brain, ChatChunk, ChatInput } from "../../brain/types";
import { CronScheduler } from "../cron";
import { HookBus } from "../hooks";
import { MemoryStore } from "../memory";
import { LifeAgentSDK } from "../sdk";
import { SkillLoader } from "../skills";
import { ToolRegistry } from "../tools";
import { createInboundReplyHandler } from "./inbound_reply";

class StubBrain implements Brain {
  constructor(private readonly result: unknown) {}
  chat(_: ChatInput): AsyncIterable<ChatChunk> {
    return {
      async *[Symbol.asyncIterator]() {
        yield await Promise.resolve({ type: "stop" as const, reason: "end" });
      },
    };
  }
  async parseStructured<T>(_: string, schema: ZodType<T>): Promise<T> {
    return schema.parse(this.result);
  }
}

const FUTURE_START = new Date(Date.now() + 60 * 60_000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60_000);

async function makeSdk(db: Db, brain: Brain) {
  const skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-inbound-"));
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
  const sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });
  return {
    sdk,
    cleanup: async () => {
      await sdk.stop();
      await rm(skillsDir, { recursive: true, force: true });
    },
  };
}

describe("inbound_reply handler", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("parses 'done' reply and updates the pending event", async () => {
    const user = await createUser(db, { telegramId: "tg_in_1" });
    const brain = new StubBrain({ status: "done" });
    const { sdk, cleanup } = await makeSdk(db, brain);
    try {
      const { eventId } = await sdk.addManualEvent({
        userId: user.id,
        title: "lift",
        startAt: FUTURE_START,
        endAt: FUTURE_END,
      });
      // Simulate that the post-ping has been sent.
      await updateEventStatus(db, eventId, "planned", { postPingSentAt: new Date() });

      const handle = createInboundReplyHandler({ db, brain });
      const out = await handle({ userId: user.id, text: "yeah, finished it" });

      expect(out.matched).toBe(true);
      expect(out.eventId).toBe(eventId);
      expect(out.status).toBe("done");

      const after = await getEventById(db, eventId);
      expect(after?.status).toBe("done");
      expect(after?.userReplyText).toBe("yeah, finished it");

      const msgs = await recentMessages(db, user.id, 5);
      expect(msgs[0]?.role).toBe("user");
      expect(msgs[0]?.content).toBe("yeah, finished it");
    } finally {
      await cleanup();
    }
  });

  it("parses 'slipped' reply with slipped_minutes and blocker", async () => {
    const user = await createUser(db, { telegramId: "tg_in_2" });
    const brain = new StubBrain({
      status: "slipped",
      slipped_minutes: 20,
      blocker: "got pulled into a meeting",
    });
    const { sdk, cleanup } = await makeSdk(db, brain);
    try {
      const { eventId } = await sdk.addManualEvent({
        userId: user.id,
        title: "deep work",
        startAt: FUTURE_START,
        endAt: FUTURE_END,
      });
      await updateEventStatus(db, eventId, "planned", { postPingSentAt: new Date() });

      const handle = createInboundReplyHandler({ db, brain });
      const out = await handle({
        userId: user.id,
        text: "ran 20 min late, meeting overran",
      });

      expect(out.matched).toBe(true);
      expect(out.status).toBe("slipped");
      expect(out.slippedMinutes).toBe(20);
      expect(out.blocker).toBe("got pulled into a meeting");

      const after = await getEventById(db, eventId);
      expect(after?.status).toBe("slipped");
      const parsed = after?.parsedState as { slipped_minutes?: number };
      expect(parsed?.slipped_minutes).toBe(20);
    } finally {
      await cleanup();
    }
  });

  it("returns matched=false when no event is awaiting a reply", async () => {
    const user = await createUser(db, { telegramId: "tg_in_3" });
    const brain = new StubBrain({ status: "done" });
    const handle = createInboundReplyHandler({ db, brain });

    const out = await handle({ userId: user.id, text: "random message" });
    expect(out.matched).toBe(false);

    // Message is still recorded.
    const msgs = await recentMessages(db, user.id, 5);
    expect(msgs).toHaveLength(1);
  });

  it("does not match an event whose user_reply_text is already set", async () => {
    const user = await createUser(db, { telegramId: "tg_in_4" });
    const brain = new StubBrain({ status: "done" });
    const { sdk, cleanup } = await makeSdk(db, brain);
    try {
      const { eventId } = await sdk.addManualEvent({
        userId: user.id,
        title: "x",
        startAt: FUTURE_START,
        endAt: FUTURE_END,
      });
      await updateEventStatus(db, eventId, "done", {
        postPingSentAt: new Date(),
        userReplyText: "already replied",
      });

      const handle = createInboundReplyHandler({ db, brain });
      const out = await handle({ userId: user.id, text: "another message" });
      expect(out.matched).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
