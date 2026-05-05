import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getUserByTelegramId, topMemoryFacts } from "@lifeagent/db";
import { ForgetButton } from "./forget-button";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);
  const facts = user ? await topMemoryFacts(db, user.id, 100) : [];

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">memory</h1>
      <p className="mb-4 text-sm text-muted">
        durable facts the agent has learned about you. delete anything that's wrong.
      </p>
      {facts.length === 0 ? (
        <p className="text-muted">no facts on file yet.</p>
      ) : (
        <ul className="space-y-2">
          {facts.map((f) => (
            <li
              key={f.id}
              className="flex items-start justify-between gap-4 border-b border-zinc-800 py-3"
            >
              <div>
                <p className="text-sm">{f.body}</p>
                <p className="font-mono text-xs text-muted">
                  {f.kind} · confidence {f.confidence.toFixed(2)}
                </p>
              </div>
              <ForgetButton id={f.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
