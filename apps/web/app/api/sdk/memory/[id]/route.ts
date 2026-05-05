import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { deleteMemoryFact, getUserByTelegramId } from "@lifeagent/db";
import { NextResponse } from "next/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  if (!user) return NextResponse.json({ ok: false }, { status: 404 });
  const { id } = await params;
  const deleted = await deleteMemoryFact(db, user.id, id);
  if (!deleted) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true });
}
