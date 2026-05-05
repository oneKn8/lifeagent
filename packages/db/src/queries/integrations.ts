import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { integrations } from "../schema";

export type Integration = typeof integrations.$inferSelect;

export interface UpsertIntegrationInput {
  userId: string;
  kind: string;
  credentialsEncrypted?: string;
  status?: string;
  lastSyncAt?: Date;
  scopes?: unknown;
}

/**
 * Upsert a row keyed on (user_id, kind). v1 has no compound unique index,
 * so we select-then-insert/update. Safe given low contention per user.
 */
export async function upsertIntegration(
  db: Db,
  input: UpsertIntegrationInput,
): Promise<Integration> {
  const existing = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.userId, input.userId),
        eq(integrations.kind, input.kind),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(integrations)
      .set({
        credentialsEncrypted: input.credentialsEncrypted,
        status: input.status,
        lastSyncAt: input.lastSyncAt,
        scopes: input.scopes as never,
      })
      .where(eq(integrations.id, existing[0].id))
      .returning();
    if (!row) throw new Error("upsertIntegration: update returned no row");
    return row;
  }

  const [row] = await db
    .insert(integrations)
    .values({
      userId: input.userId,
      kind: input.kind,
      credentialsEncrypted: input.credentialsEncrypted,
      status: input.status,
      lastSyncAt: input.lastSyncAt,
      scopes: input.scopes as never,
    })
    .returning();
  if (!row) throw new Error("upsertIntegration: insert returned no row");
  return row;
}

export async function getIntegration(
  db: Db,
  userId: string,
  kind: string,
): Promise<Integration | null> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.kind, kind)))
    .limit(1);
  return rows[0] ?? null;
}
