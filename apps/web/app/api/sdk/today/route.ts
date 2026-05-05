import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getEventsForDay, getUserByTelegramId } from "@lifeagent/db";
import { NextResponse } from "next/server";

export async function GET() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  if (!user) return NextResponse.json({ events: [] });
  const rows = await getEventsForDay(db, user.id, new Date());
  return NextResponse.json({
    events: rows.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      status: e.status,
      verificationStatus: e.verificationStatus,
      notes: e.notes,
    })),
  });
}
