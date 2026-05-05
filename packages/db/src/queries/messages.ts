import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { messages } from "../schema";

export type Message = typeof messages.$inferSelect;

export interface AppendMessageInput {
  userId: string;
  role: string;
  channel: string;
  content: string;
  attachments?: unknown;
  relatedEventId?: string;
}

export async function appendMessage(
  db: Db,
  input: AppendMessageInput,
): Promise<Message> {
  const [row] = await db
    .insert(messages)
    .values({
      userId: input.userId,
      role: input.role,
      channel: input.channel,
      content: input.content,
      attachments: input.attachments as never,
      relatedEventId: input.relatedEventId,
    })
    .returning();
  if (!row) throw new Error("appendMessage: insert returned no row");
  return row;
}

export async function recentMessages(
  db: Db,
  userId: string,
  limit: number,
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}
