import { Bot } from "grammy";

export interface OutboundApi {
  sendMessage(chatId: number | string, text: string): Promise<void>;
}

export interface TelegramUpdate {
  chatId: number;
  fromUserId: number;
  text: string;
}

export type MessageHandler = (update: TelegramUpdate) => Promise<void> | void;

export interface TelegramAdapterOptions {
  token: string;
  ownerId: number;
  onMessage: MessageHandler;
  api?: OutboundApi;
}

export class TelegramAdapter {
  private readonly token: string;
  private readonly ownerId: number;
  private readonly onMessage: MessageHandler;
  private readonly api: OutboundApi;
  private bot: Bot | null = null;

  constructor(opts: TelegramAdapterOptions) {
    this.token = opts.token;
    this.ownerId = opts.ownerId;
    this.onMessage = opts.onMessage;
    this.api = opts.api ?? this.defaultApi();
  }

  private defaultApi(): OutboundApi {
    return {
      sendMessage: async (chatId, text) => {
        await this.ensureBot().api.sendMessage(chatId, text);
      },
    };
  }

  private ensureBot(): Bot {
    if (!this.bot) this.bot = new Bot(this.token);
    return this.bot;
  }

  async dispatch(update: TelegramUpdate): Promise<void> {
    if (update.fromUserId !== this.ownerId) return;

    const text = update.text.trim();
    if (text === "/start") {
      await this.api.sendMessage(update.chatId, "lifeagent online");
      return;
    }
    if (text === "/whoami") {
      await this.api.sendMessage(update.chatId, `chat id: ${update.chatId}`);
      return;
    }

    await this.onMessage(update);
  }

  async send(text: string): Promise<void> {
    await this.api.sendMessage(this.ownerId, text);
  }

  async sendTo(chatId: number | string, text: string): Promise<void> {
    await this.api.sendMessage(chatId, text);
  }

  async start(): Promise<void> {
    const bot = this.ensureBot();
    bot.on("message:text", async (ctx) => {
      const fromUserId = ctx.from?.id;
      const chatId = ctx.chat.id;
      const text = ctx.message.text;
      if (fromUserId === undefined) return;
      await this.dispatch({ chatId, fromUserId, text });
    });
    await bot.start();
  }

  async stop(): Promise<void> {
    if (this.bot) await this.bot.stop();
  }
}
