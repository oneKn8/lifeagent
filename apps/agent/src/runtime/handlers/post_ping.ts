import { type Db, type Event, getEventById, updateEvent } from "@lifeagent/db";
import type { CronHandler } from "../cron";
import type { AgentLoop } from "../loop";
import type { MemoryStore } from "../memory";
import type { SkillLoader } from "../skills";

export interface PostPingDeps {
  db: Db;
  loop: AgentLoop;
  skills: SkillLoader;
  memory: MemoryStore;
  /** Top-N memory facts to include in the prompt. Default 8. */
  memoryTopN?: number;
}

export function createPostPingHandler(deps: PostPingDeps): CronHandler {
  const memoryTopN = deps.memoryTopN ?? 8;
  return async (job) => {
    const payload = job.payload as { eventId?: string } | null;
    const eventId = payload?.eventId;
    if (!eventId) return;

    const event = await getEventById(deps.db, eventId);
    if (!event) return;
    if (event.postPingSentAt) return;

    const persona = deps.skills.findByName("lifeagent");
    const facts = await deps.memory.topRecent(event.userId, memoryTopN);
    const system = buildPostPingSystem(persona?.body, facts, event);

    await deps.loop.run({
      system,
      userMessage: "Send the post-ping for this event now.",
      userId: event.userId,
      eventId: event.id,
    });

    await updateEvent(deps.db, event.id, { postPingSentAt: new Date() });
  };
}

function buildPostPingSystem(
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
    "# Event just ended",
    `- title: ${event.title}`,
    `- started: ${event.startAt.toISOString()}`,
    `- ended: ${event.endAt.toISOString()}`,
  ];
  if (event.notes) eventLines.push(`- notes: ${event.notes}`);
  if (event.userReplyText) eventLines.push(`- prior reply: ${event.userReplyText}`);
  sections.push(eventLines.join("\n"));
  sections.push(
    "Use the send_message tool to ask exactly one short follow-up: did they finish? Possible answers: done, partial, skipped, slipped. Keep it under 2 sentences.",
  );
  return sections.join("\n\n");
}
