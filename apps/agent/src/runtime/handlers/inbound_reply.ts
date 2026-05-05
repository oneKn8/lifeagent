import {
  type Db,
  type EventStatus,
  appendMessage,
  getLatestPendingPostPingEvent,
  updateEventStatus,
} from "@lifeagent/db";
import { z } from "zod";
import type { Brain } from "../../brain/types";

export interface InboundReplyDeps {
  db: Db;
  brain: Brain;
}

export interface InboundReplyInput {
  userId: string;
  text: string;
}

export interface InboundReplyResult {
  matched: boolean;
  eventId?: string;
  status?: EventStatus;
  slippedMinutes?: number;
  blocker?: string;
}

const replySchema = z.object({
  status: z.enum(["done", "partial", "skipped", "slipped"]),
  slipped_minutes: z.number().int().nonnegative().optional(),
  blocker: z.string().optional(),
});

const PROMPT = `You are a parser. Convert the user's free-form reply into a structured update for the event below.

Rules:
- Pick exactly one status: "done" | "partial" | "skipped" | "slipped".
- "done": fully completed.
- "partial": started and made progress but did not complete.
- "skipped": did not do it at all, no plan to recover today.
- "slipped": ran late or pushed it; "slipped_minutes" should be a non-negative integer if mentioned.
- "blocker": a short phrase if the user described why; omit if unclear.

Return JSON only.`;

export function createInboundReplyHandler(deps: InboundReplyDeps) {
  return async (input: InboundReplyInput): Promise<InboundReplyResult> => {
    await appendMessage(deps.db, {
      userId: input.userId,
      role: "user",
      channel: "telegram",
      content: input.text,
    });

    const event = await getLatestPendingPostPingEvent(deps.db, input.userId);
    if (!event) {
      return { matched: false };
    }

    const fullPrompt = `${PROMPT}

Event:
- title: ${event.title}
- ended at: ${event.endAt.toISOString()}

User reply:
${input.text}`;

    const parsed = await deps.brain.parseStructured(fullPrompt, replySchema);

    await updateEventStatus(deps.db, event.id, parsed.status, {
      userReplyText: input.text,
      parsedState: parsed,
    });

    return {
      matched: true,
      eventId: event.id,
      status: parsed.status,
      slippedMinutes: parsed.slipped_minutes,
      blocker: parsed.blocker,
    };
  };
}
