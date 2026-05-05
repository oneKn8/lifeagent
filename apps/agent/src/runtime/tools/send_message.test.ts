import { beforeEach, describe, expect, it } from "bun:test";
import { type Db, createEvent, createUser, makeTestDb, recentMessages } from "@lifeagent/db";
import { TelegramAdapter } from "../../adapters/telegram";
import { ToolRegistry } from "../tools";
import { createSendMessageTool } from "./send_message";
import { createSendVoiceNoteTool } from "./send_voice_note";

interface SentCall {
  chatId: number | string;
  text: string;
}

function makeFakeApi() {
  const sent: SentCall[] = [];
  return {
    sent,
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
    },
  };
}

const OWNER = 42;

describe("send_message tool", () => {
  let db: Db;
  let api: ReturnType<typeof makeFakeApi>;
  let adapter: TelegramAdapter;

  beforeEach(async () => {
    db = await makeTestDb();
    api = makeFakeApi();
    adapter = new TelegramAdapter({
      token: "t",
      ownerId: OWNER,
      onMessage: () => {},
      api,
    });
  });

  it("sends via the adapter and writes a messages row", async () => {
    const user = await createUser(db, { telegramId: "tg_send_1" });
    const reg = new ToolRegistry();
    reg.register(createSendMessageTool({ adapter, db }));

    await reg.dispatch("send_message", { text: "hello world" }, { userId: user.id });

    expect(api.sent).toEqual([{ chatId: OWNER, text: "hello world" }]);
    const rows = await recentMessages(db, user.id, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("assistant");
    expect(rows[0]?.channel).toBe("telegram");
    expect(rows[0]?.content).toBe("hello world");
  });

  it("links the messages row to ctx.eventId when present", async () => {
    const user = await createUser(db, { telegramId: "tg_send_2" });
    const reg = new ToolRegistry();
    reg.register(createSendMessageTool({ adapter, db }));

    const startAt = new Date();
    const event = await createEvent(db, {
      userId: user.id,
      title: "test event",
      startAt,
      endAt: new Date(startAt.getTime() + 60_000),
      source: "manual",
    });

    await reg.dispatch("send_message", { text: "ping" }, { userId: user.id, eventId: event.id });

    const rows = await recentMessages(db, user.id, 10);
    expect(rows[0]?.relatedEventId).toBe(event.id);
  });

  it("rejects empty text", async () => {
    const user = await createUser(db, { telegramId: "tg_send_3" });
    const reg = new ToolRegistry();
    reg.register(createSendMessageTool({ adapter, db }));

    await expect(reg.dispatch("send_message", { text: "" }, { userId: user.id })).rejects.toThrow();
    expect(api.sent).toEqual([]);
  });
});

describe("send_voice_note tool", () => {
  let db: Db;
  let api: ReturnType<typeof makeFakeApi>;
  let adapter: TelegramAdapter;

  beforeEach(async () => {
    db = await makeTestDb();
    api = makeFakeApi();
    adapter = new TelegramAdapter({
      token: "t",
      ownerId: OWNER,
      onMessage: () => {},
      api,
    });
  });

  it("falls back to a [voice] text message when no TTS is configured", async () => {
    const user = await createUser(db, { telegramId: "tg_voice_1" });
    const reg = new ToolRegistry();
    reg.register(createSendVoiceNoteTool({ adapter, db }));

    await reg.dispatch("send_voice_note", { text: "remember to drink water" }, { userId: user.id });

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.chatId).toBe(OWNER);
    expect(api.sent[0]?.text).toContain("[voice]");
    expect(api.sent[0]?.text).toContain("remember to drink water");

    const rows = await recentMessages(db, user.id, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("assistant");
    expect(rows[0]?.channel).toBe("telegram");
    expect(rows[0]?.content).toContain("remember to drink water");
  });
});
