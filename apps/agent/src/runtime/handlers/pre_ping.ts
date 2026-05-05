import { type Db, type Event, getEventById, updateEvent } from "@lifeagent/db";
import type { CronHandler } from "../cron";
import type { AgentLoop } from "../loop";
import type { MemoryStore } from "../memory";
import type { SkillLoader } from "../skills";

export interface PrePingDeps {
  db: Db;
  loop: AgentLoop;
  skills: SkillLoader;
  memory: MemoryStore;
  /** Top-N memory facts to include in the prompt. Default 8. */
  memoryTopN?: number;
}

export function createPrePingHandler(deps: PrePingDeps): CronHandler {
  const memoryTopN = deps.memoryTopN ?? 8;
  return async (job) => {
    const payload = job.payload as { eventId?: string } | null;
    const eventId = payload?.eventId;
    if (!eventId) return;

    const event = await getEventById(deps.db, eventId);
    if (!event) return; // event was deleted
    if (event.prePingSentAt) return; // already sent — idempotent

    const persona = deps.skills.findByName("lifeagent");
    const facts = await deps.memory.topRecent(event.userId, memoryTopN);
    const system = buildPrePingSystem(persona?.body, facts, event);

    await deps.loop.run({
      system,
      userMessage: "Send the pre-ping for this event now.",
      userId: event.userId,
      eventId: event.id,
    });

    await updateEvent(deps.db, event.id, { prePingSentAt: new Date() });
  };
}

function buildPrePingSystem(
  personaBody: string | undefined,
  facts: Array<{ kind: string; body: string }>,
  event: Event,
): string {
  const sections: string[] = [];
  if (personaBody) sections.push(personaBody.trim());
  if (facts.length > 0) {
    sections.push(`# Memory\n${facts.map((f) => `- (${f.kind}) ${f.body}`).join("\n")}`);
  }
  const eventLines = [
    "# Upcoming event",
    `- title: ${event.title}`,
    `- starts: ${event.startAt.toISOString()}`,
    `- ends: ${event.endAt.toISOString()}`,
  ];
  if (event.notes) eventLines.push(`- notes: ${event.notes}`);
  sections.push(eventLines.join("\n"));
  sections.push(
    "Use the send_message tool to deliver one short pre-ping line. Reference the event title. Do not include emoji.",
  );
  return sections.join("\n\n");
}
