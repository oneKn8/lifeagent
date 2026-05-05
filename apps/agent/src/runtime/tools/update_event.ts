import { z } from "zod";
import type { LifeAgentSDK } from "../sdk";
import type { Tool } from "../tools";

export interface UpdateEventDeps {
  sdk: Pick<LifeAgentSDK, "updateManualEvent">;
}

const inputSchema = z
  .object({
    eventId: z.string().uuid(),
    title: z.string().min(1).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.startAt !== undefined ||
      v.endAt !== undefined ||
      v.notes !== undefined,
    { message: "at least one of title, startAt, endAt, notes must be provided" },
  );

export type UpdateEventInput = z.infer<typeof inputSchema>;
export type UpdateEventOutput = { eventId: string };

export function createUpdateEventTool(
  deps: UpdateEventDeps,
): Tool<UpdateEventInput, UpdateEventOutput> {
  return {
    name: "update_event",
    description:
      "Update a manual event's title, times, or notes. Reschedules pre/post pings if times change and pings have not yet fired.",
    inputSchema,
    async run({ input, userId }) {
      const result = await deps.sdk.updateManualEvent({
        userId,
        eventId: input.eventId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        notes: input.notes,
      });
      return { eventId: result.event.id };
    },
  };
}
