import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getEventsForDay, getUserByTelegramId } from "@lifeagent/db";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  const events = user ? await getEventsForDay(db, user.id, new Date()) : [];
  events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">today</h1>
      {events.length === 0 ? (
        <p className="text-muted">no scheduled items today.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between border-b border-zinc-800 py-3"
            >
              <div>
                <p className="font-medium">{e.title}</p>
                <p className="font-mono text-xs text-muted">
                  {e.startAt.toISOString().slice(11, 16)} – {e.endAt.toISOString().slice(11, 16)}
                </p>
              </div>
              <span className="font-mono text-xs uppercase" data-status={e.status}>
                {e.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
