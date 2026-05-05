import { z } from "zod";
import type { LifeAgentSDK } from "../sdk";
import type { Tool } from "../tools";

export interface AddEventDeps {
  sdk: Pick<LifeAgentSDK, "addManualEvent">;
}

const inputSchema = z
  .object({
    title: z.string().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    source: z.literal("manual"),
    notes: z.string().optional(),
  })
  .refine((v) => v.endAt.getTime() > v.startAt.getTime(), {
    message: "endAt must be after startAt",
  });

export type AddEventInput = z.infer<typeof inputSchema>;
export type AddEventOutput = { eventId: string };

export function createAddEventTool(deps: AddEventDeps): Tool<AddEventInput, AddEventOutput> {
  return {
    name: "add_event",
    description:
      "Create a manual event. Schedules a pre-ping 5 minutes before startAt and a post-ping at endAt.",
    inputSchema,
    async run({ input, userId }) {
      return deps.sdk.addManualEvent({
        userId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        notes: input.notes,
      });
    },
  };
}
