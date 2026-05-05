import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getEventsBySourceInRange, getUserByTelegramId } from "@lifeagent/db";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const events = user
    ? [
        ...(await getEventsBySourceInRange(db, user.id, "manual", { start: monthAgo, end: now })),
        ...(await getEventsBySourceInRange(db, user.id, "gcal", { start: monthAgo, end: now })),
      ]
    : [];
  events.sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">history</h1>
      {events.length === 0 ? (
        <p className="text-muted">no past events on file.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 text-left">when</th>
              <th className="py-2 text-left">title</th>
              <th className="py-2 text-left">status</th>
              <th className="py-2 text-left">verifier</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-zinc-800">
                <td className="py-2 font-mono text-xs">
                  {e.startAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-2">{e.title}</td>
                <td className="py-2 font-mono text-xs">{e.status}</td>
                <td className="py-2 font-mono text-xs">{e.verificationStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
