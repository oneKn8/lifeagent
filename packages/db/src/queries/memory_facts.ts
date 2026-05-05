import { and, desc, eq, ilike } from "drizzle-orm";
import type { Db } from "../client";
import { memoryFacts } from "../schema";

export type MemoryFact = typeof memoryFacts.$inferSelect;

export interface AddMemoryFactInput {
  userId: string;
  kind: string;
  body: string;
  confidence?: number;
  sourceMessageId?: string;
  lastUsedAt?: Date;
}

export async function addMemoryFact(
  db: Db,
  input: AddMemoryFactInput,
): Promise<MemoryFact> {
  const [row] = await db
    .insert(memoryFacts)
    .values({
      userId: input.userId,
      kind: input.kind,
      body: input.body,
      confidence: input.confidence,
      sourceMessageId: input.sourceMessageId,
      lastUsedAt: input.lastUsedAt,
    })
    .returning();
  if (!row) throw new Error("addMemoryFact: insert returned no row");
  return row;
}

export async function topMemoryFacts(
  db: Db,
  userId: string,
  n: number,
): Promise<MemoryFact[]> {
  return db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.userId, userId))
    .orderBy(desc(memoryFacts.lastUsedAt))
    .limit(n);
}

/**
 * v1: simple case-insensitive LIKE search over `body`, scoped to user.
 */
export async function searchMemoryFacts(
  db: Db,
  userId: string,
  query: string,
): Promise<MemoryFact[]> {
  const pattern = `%${query}%`;
  return db
    .select()
    .from(memoryFacts)
    .where(
      and(eq(memoryFacts.userId, userId), ilike(memoryFacts.body, pattern)),
    )
    .orderBy(desc(memoryFacts.lastUsedAt));
}
