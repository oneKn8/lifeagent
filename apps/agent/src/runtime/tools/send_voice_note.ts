import { type Db, appendMessage } from "@lifeagent/db";
import { z } from "zod";
import type { TelegramAdapter } from "../../adapters/telegram";
import type { Tool } from "../tools";

export interface SendVoiceNoteDeps {
  adapter: Pick<TelegramAdapter, "send">;
  db: Db;
}

const inputSchema = z.object({
  text: z.string().min(1),
});

export type SendVoiceNoteInput = z.infer<typeof inputSchema>;
export type SendVoiceNoteOutput = { messageId: string };

export function createSendVoiceNoteTool(
  deps: SendVoiceNoteDeps,
): Tool<SendVoiceNoteInput, SendVoiceNoteOutput> {
  return {
    name: "send_voice_note",
    description:
      "Send a voice note to the user. v0 fallback: delivers as a text message prefixed with [voice].",
    inputSchema,
    async run({ input, userId, eventId }) {
      const body = `[voice] ${input.text}`;
      await deps.adapter.send(body);
      const row = await appendMessage(deps.db, {
        userId,
        role: "assistant",
        channel: "telegram",
        content: body,
        relatedEventId: eventId,
      });
      return { messageId: row.id };
    },
  };
}
