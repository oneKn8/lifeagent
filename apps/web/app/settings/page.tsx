import { requireOwner } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { getUserByTelegramId } from "@lifeagent/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const owner = await requireOwner();
  const db = getDb();
  const user = await getUserByTelegramId(db, owner.telegramId);

  const provider = process.env.BRAIN_PROVIDER ?? "openrouter";
  const integrations = [
    { name: "Strava", env: "STRAVA_CLIENT_ID" },
    { name: "GitHub PAT", env: "GITHUB_PAT" },
    { name: "Wakatime", env: "WAKATIME_API_KEY" },
    { name: "Google Calendar", env: "GOOGLE_CLIENT_ID" },
    { name: "Accountability contact", env: "OWNER_CONTACT_TELEGRAM_ID" },
  ];

  return (
    <section className="space-y-8">
      <div>
        <h1 className="mb-6 text-2xl font-semibold">settings</h1>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">user id</dt>
          <dd className="font-mono">{user?.id ?? "—"}</dd>
          <dt className="text-muted">telegram id</dt>
          <dd className="font-mono">{owner.telegramId}</dd>
          <dt className="text-muted">brain provider</dt>
          <dd className="font-mono">{provider}</dd>
        </dl>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">integrations</h2>
        <ul className="space-y-1 text-sm">
          {integrations.map((i) => {
            const enabled = Boolean(process.env[i.env]);
            return (
              <li key={i.name} className="flex justify-between border-b border-zinc-800 py-2">
                <span>{i.name}</span>
                <span className="font-mono text-xs text-muted">
                  {enabled ? "configured" : "off"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="rounded border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
        >
          log out
        </button>
      </form>
    </section>
  );
}
