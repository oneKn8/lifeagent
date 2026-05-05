import { type Db, type Event, getEventById } from "@lifeagent/db";
import type { TelegramAdapter } from "../../adapters/telegram";
import type { CronHandler, CronScheduler } from "../cron";
import type { AgentLoop } from "../loop";
import type { SkillLoader } from "../skills";

export interface EscalationDeps {
  db: Db;
  loop: AgentLoop;
  skills: SkillLoader;
  /** If supplied, sends a one-line accountability ping at the final escalation step. */
  adapter?: Pick<TelegramAdapter, "sendTo">;
  accountabilityChatId?: number;
}

export type EscalationAttempt = 1 | 2 | 3;

const TONE_BY_ATTEMPT: Record<EscalationAttempt, string> = {
  1: "Friendly nudge: gently re-ask if they finished. One sentence.",
  2: "Slightly firmer: it's been ~15 minutes with no answer. Direct, not aggressive. One sentence.",
  3: "Sharper: half an hour with no reply. State the fact and ask for a yes/no. One short sentence.",
};

export function createEscalationHandler(deps: EscalationDeps): CronHandler {
  return async (job) => {
    const payload = job.payload as { eventId?: string; attempt?: EscalationAttempt } | null;
    const eventId = payload?.eventId;
    const attempt = (payload?.attempt ?? 1) as EscalationAttempt;
    if (!eventId) return;

    const event = await getEventById(deps.db, eventId);
    if (!event) return;
    if (event.userReplyText) return; // user already replied; nothing to escalate

    const persona = deps.skills.findByName("lifeagent");
    const system = buildSystem(persona?.body, event, attempt);
    await deps.loop.run({
      system,
      userMessage: `Send escalation attempt ${attempt} now.`,
      userId: event.userId,
      eventId: event.id,
    });

    if (attempt === 3 && deps.adapter && deps.accountabilityChatId !== undefined) {
      await deps.adapter.sendTo(
        deps.accountabilityChatId,
        `lifeagent: missed event "${event.title}" with no reply for 30 minutes. Ping?`,
      );
    }
  };
}

function buildSystem(
  personaBody: string | undefined,
  event: Event,
  attempt: EscalationAttempt,
): string {
  const sections: string[] = [];
  if (personaBody) sections.push(personaBody.trim());
  sections.push(
    [
      "# Event awaiting reply",
      `- title: ${event.title}`,
      `- ended: ${event.endAt.toISOString()}`,
    ].join("\n"),
  );
  sections.push(`# Tone\n${TONE_BY_ATTEMPT[attempt]}`);
  sections.push("Use the send_message tool to deliver. Stay under two sentences.");
  return sections.join("\n\n");
}

export interface ScheduleEscalationsOptions {
  cron: CronScheduler;
  userId: string;
  eventId: string;
  /** Override delays in minutes. Default [5, 15, 30]. */
  stepsMinutes?: [number, number, number];
  /** Anchor for delays. Default new Date(). */
  now?: Date;
}

export async function scheduleEscalations(opts: ScheduleEscalationsOptions): Promise<string[]> {
  const steps = opts.stepsMinutes ?? [5, 15, 30];
  const anchor = (opts.now ?? new Date()).getTime();
  const ids: string[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const attempt = (i + 1) as EscalationAttempt;
    const stepMin = steps[i];
    if (stepMin === undefined) continue;
    const fireAt = new Date(anchor + stepMin * 60_000);
    const { id } = await opts.cron.schedule({
      userId: opts.userId,
      kind: "escalation",
      nextRunAt: fireAt,
      payload: { eventId: opts.eventId, attempt },
    });
    ids.push(id);
  }
  return ids;
}
