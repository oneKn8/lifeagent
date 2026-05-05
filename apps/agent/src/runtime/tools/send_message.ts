import { type Db, appendMessage } from "@lifeagent/db";
import { z } from "zod";
import type { TelegramAdapter } from "../../adapters/telegram";
import type { Tool } from "../tools";

export interface SendMessageDeps {
  adapter: Pick<TelegramAdapter, "send">;
  db: Db;
}

const inputSchema = z.object({
  text: z.string().min(1),
});

export type SendMessageInput = z.infer<typeof inputSchema>;
export type SendMessageOutput = { messageId: string };

export function createSendMessageTool(
  deps: SendMessageDeps,
): Tool<SendMessageInput, SendMessageOutput> {
  return {
    name: "send_message",
    description: "Send a text message to the user via Telegram and log it to the messages table.",
    inputSchema,
    async run({ input, userId, eventId }) {
      await deps.adapter.send(input.text);
      const row = await appendMessage(deps.db, {
        userId,
        role: "assistant",
        channel: "telegram",
        content: input.text,
        relatedEventId: eventId,
      });
      return { messageId: row.id };
    },
  };
}
