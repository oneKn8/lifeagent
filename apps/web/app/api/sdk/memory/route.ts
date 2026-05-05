import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getUserByTelegramId, topMemoryFacts } from "@lifeagent/db";
import { NextResponse } from "next/server";

export async function GET() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  if (!user) return NextResponse.json({ facts: [] });
  const facts = await topMemoryFacts(db, user.id, 100);
  return NextResponse.json({
    facts: facts.map((f) => ({
      id: f.id,
      kind: f.kind,
      body: f.body,
      confidence: f.confidence,
    })),
  });
}
