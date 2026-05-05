import { z } from "zod";
import type { LifeAgentSDK } from "../sdk";
import type { Tool } from "../tools";

export interface MarkEventStatusDeps {
  sdk: Pick<LifeAgentSDK, "markEventStatus">;
}

const inputSchema = z.object({
  eventId: z.string().uuid(),
  status: z.enum(["done", "partial", "skipped", "slipped"]),
  userReplyText: z.string().optional(),
  notes: z.string().optional(),
});

export type MarkEventStatusInput = z.infer<typeof inputSchema>;
export type MarkEventStatusOutput = { eventId: string; status: MarkEventStatusInput["status"] };

export function createMarkEventStatusTool(
  deps: MarkEventStatusDeps,
): Tool<MarkEventStatusInput, MarkEventStatusOutput> {
  return {
    name: "mark_event_status",
    description:
      "Mark an event's outcome status (done | partial | skipped | slipped) with an optional reply and notes.",
    inputSchema,
    async run({ input, userId }) {
      const result = await deps.sdk.markEventStatus({
        userId,
        eventId: input.eventId,
        status: input.status,
        userReplyText: input.userReplyText,
        notes: input.notes,
      });
      return { eventId: result.event.id, status: input.status };
    },
  };
}
