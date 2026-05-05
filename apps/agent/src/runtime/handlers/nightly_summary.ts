import { type Db, type Event, getEventsForDay } from "@lifeagent/db";
import type { CronHandler } from "../cron";
import type { AgentLoop } from "../loop";
import type { MemoryStore } from "../memory";
import type { SkillLoader } from "../skills";

export interface NightlySummaryDeps {
  db: Db;
  loop: AgentLoop;
  skills: SkillLoader;
  memory: MemoryStore;
  memoryTopN?: number;
}

export function createNightlySummaryHandler(deps: NightlySummaryDeps): CronHandler {
  const memoryTopN = deps.memoryTopN ?? 8;
  return async (job) => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
    const today = await getEventsForDay(deps.db, job.userId, now);
    const next = await getEventsForDay(deps.db, job.userId, tomorrow);
    const skill = deps.skills.findByName("daily-summary");
    const facts = await deps.memory.topRecent(job.userId, memoryTopN);
    const system = buildSystem(skill?.body, facts, today, next);
    await deps.loop.run({
      system,
      userMessage: "Send tonight's summary now.",
      userId: job.userId,
    });
  };
}

function buildSystem(
  skillBody: string | undefined,
  facts: Array<{ kind: string; body: string }>,
  today: Event[],
  tomorrow: Event[],
): string {
  const sections: string[] = [];
  if (skillBody) sections.push(skillBody.trim());
  if (facts.length > 0) {
    sections.push(`# Memory\n${facts.map((f) => `- (${f.kind}) ${f.body}`).join("\n")}`);
  }
  if (today.length === 0) {
    sections.push("# Today\n(no scheduled items today)");
  } else {
    sections.push(`# Today\n${today.map((e) => `- ${e.status}  ${e.title}`).join("\n")}`);
  }
  if (tomorrow.length > 0) {
    sections.push(
      `# Tomorrow\n${tomorrow.map((e) => `- ${formatHHMM(e.startAt)}  ${e.title}`).join("\n")}`,
    );
  }
  sections.push("Use the send_message tool to deliver the summary. Stay under 14 lines.");
  return sections.join("\n\n");
}

function formatHHMM(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
