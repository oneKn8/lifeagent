import { type Db, type Event, getEventsForDay } from "@lifeagent/db";
import type { CronHandler } from "../cron";
import type { AgentLoop } from "../loop";
import type { MemoryStore } from "../memory";
import type { SkillLoader } from "../skills";

export interface MorningBriefDeps {
  db: Db;
  loop: AgentLoop;
  skills: SkillLoader;
  memory: MemoryStore;
  /** Top-N memory facts to include. Default 8. */
  memoryTopN?: number;
}

export function createMorningBriefHandler(deps: MorningBriefDeps): CronHandler {
  const memoryTopN = deps.memoryTopN ?? 8;
  return async (job) => {
    const today = new Date();
    const events = await getEventsForDay(deps.db, job.userId, today);
    const skill = deps.skills.findByName("daily-brief");
    const facts = await deps.memory.topRecent(job.userId, memoryTopN);
    const system = buildSystem(skill?.body, facts, events);
    await deps.loop.run({
      system,
      userMessage: "Send today's morning brief now.",
      userId: job.userId,
    });
  };
}

function buildSystem(
  skillBody: string | undefined,
  facts: Array<{ kind: string; body: string }>,
  events: Event[],
): string {
  const sections: string[] = [];
  if (skillBody) sections.push(skillBody.trim());
  if (facts.length > 0) {
    sections.push(`# Memory\n${facts.map((f) => `- (${f.kind}) ${f.body}`).join("\n")}`);
  }
  if (events.length === 0) {
    sections.push("# Today\n(no scheduled items)");
  } else {
    const lines = events
      .slice()
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((e) => `- ${formatHHMM(e.startAt)}  ${e.title}`)
      .join("\n");
    sections.push(`# Today\n${lines}`);
  }
  sections.push("Use the send_message tool to deliver the brief. Stay under 12 lines.");
  return sections.join("\n\n");
}

function formatHHMM(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
