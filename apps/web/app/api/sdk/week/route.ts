import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getEventsBySourceInRange, getUserByTelegramId } from "@lifeagent/db";
import { NextResponse } from "next/server";

export async function GET() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  if (!user) return NextResponse.json({ events: [] });
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const all = [
    ...(await getEventsBySourceInRange(db, user.id, "manual", { start: now, end: weekAhead })),
    ...(await getEventsBySourceInRange(db, user.id, "gcal", { start: now, end: weekAhead })),
  ];
  all.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return NextResponse.json({
    events: all.map((e) => ({
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
