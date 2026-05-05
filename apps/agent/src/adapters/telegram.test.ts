import { beforeEach, describe, expect, it } from "bun:test";
import { TelegramAdapter, type TelegramUpdate } from "./telegram";

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

const OWNER = 123456;
const STRANGER = 999;

describe("TelegramAdapter", () => {
  let api: ReturnType<typeof makeFakeApi>;
  let received: TelegramUpdate[];
  let adapter: TelegramAdapter;

  beforeEach(() => {
    api = makeFakeApi();
    received = [];
    adapter = new TelegramAdapter({
      token: "test-token",
      ownerId: OWNER,
      onMessage: (u) => {
        received.push(u);
      },
      api,
    });
  });

  it("replies 'lifeagent online' on /start", async () => {
    await adapter.dispatch({ chatId: OWNER, fromUserId: OWNER, text: "/start" });
    expect(api.sent).toEqual([{ chatId: OWNER, text: "lifeagent online" }]);
    expect(received).toEqual([]);
  });

  it("replies with the chat id on /whoami", async () => {
    await adapter.dispatch({ chatId: OWNER, fromUserId: OWNER, text: "/whoami" });
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.chatId).toBe(OWNER);
    expect(api.sent[0]?.text).toContain(String(OWNER));
  });

  it("routes non-command messages to onMessage and does not auto-reply", async () => {
    await adapter.dispatch({ chatId: OWNER, fromUserId: OWNER, text: "hello there" });
    expect(api.sent).toEqual([]);
    expect(received).toEqual([{ chatId: OWNER, fromUserId: OWNER, text: "hello there" }]);
  });

  it("ignores updates from non-owner users (whitelist)", async () => {
    await adapter.dispatch({ chatId: STRANGER, fromUserId: STRANGER, text: "/start" });
    await adapter.dispatch({ chatId: STRANGER, fromUserId: STRANGER, text: "hi" });
    expect(api.sent).toEqual([]);
    expect(received).toEqual([]);
  });

  it("send(text) sends to the configured owner chat", async () => {
    await adapter.send("ping");
    expect(api.sent).toEqual([{ chatId: OWNER, text: "ping" }]);
  });

  it("awaits async onMessage handlers before resolving dispatch", async () => {
    let resolved = false;
    const slowAdapter = new TelegramAdapter({
      token: "t",
      ownerId: OWNER,
      onMessage: async () => {
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
      },
      api,
    });
    await slowAdapter.dispatch({ chatId: OWNER, fromUserId: OWNER, text: "anything" });
    expect(resolved).toBe(true);
  });
});
