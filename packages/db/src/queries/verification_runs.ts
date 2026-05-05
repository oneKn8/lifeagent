import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { verificationRuns } from "../schema";

export type VerificationRun = typeof verificationRuns.$inferSelect;

export interface RecordVerificationRunInput {
  userId: string;
  eventId: string;
  verifier: string;
  consistent?: boolean;
  confidence?: number;
  summary?: string;
  evidence?: unknown;
}

export async function recordVerificationRun(
  db: Db,
  input: RecordVerificationRunInput,
): Promise<VerificationRun> {
  const [row] = await db
    .insert(verificationRuns)
    .values({
      userId: input.userId,
      eventId: input.eventId,
      verifier: input.verifier,
      consistent: input.consistent,
      confidence: input.confidence,
      summary: input.summary,
      evidence: input.evidence as never,
    })
    .returning();
  if (!row) throw new Error("recordVerificationRun: insert returned no row");
  return row;
}

export async function getVerificationsForEvent(
  db: Db,
  eventId: string,
): Promise<VerificationRun[]> {
  return db
    .select()
    .from(verificationRuns)
    .where(eq(verificationRuns.eventId, eventId))
    .orderBy(desc(verificationRuns.createdAt));
}
