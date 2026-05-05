import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getEventsBySourceInRange, getUserByTelegramId } from "@lifeagent/db";

export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function WeekPage() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const events = user
    ? [
        ...(await getEventsBySourceInRange(db, user.id, "manual", { start: now, end: weekAhead })),
        ...(await getEventsBySourceInRange(db, user.id, "gcal", { start: now, end: weekAhead })),
      ]
    : [];
  events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const key = dayKey(e.startAt);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">this week</h1>
      {byDay.size === 0 ? (
        <p className="text-muted">no upcoming events.</p>
      ) : (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <h2 className="mb-2 font-mono text-sm text-muted">{day}</h2>
              <ul className="space-y-1">
                {list.map((e) => (
                  <li key={e.id} className="flex justify-between py-1">
                    <span>{e.title}</span>
                    <span className="font-mono text-xs text-muted">
                      {e.startAt.toISOString().slice(11, 16)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
