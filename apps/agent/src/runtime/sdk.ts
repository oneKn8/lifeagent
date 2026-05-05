import {
  type Db,
  type Event,
  type EventStatus,
  appendMessage,
  createEvent,
  getActiveCronJobsByEventId,
  getEventById,
  getEventsForDay,
  recentMessages,
  updateEvent,
  updateEventStatus,
} from "@lifeagent/db";
import type { Brain } from "../brain/types";
import type { CronScheduler } from "./cron";
import type { HookBus } from "./hooks";
import { AgentLoop, type LoopResult } from "./loop";
import type { MemoryStore } from "./memory";
import type { SkillLoader } from "./skills";
import type { ToolRegistry } from "./tools";

export type Channel = "telegram" | "web" | "cli";

export interface SDKOpts {
  db: Db;
  brain: Brain;
  tools: ToolRegistry;
  hooks: HookBus;
  skills: SkillLoader;
  cron: CronScheduler;
  memory: MemoryStore;
  /** Per-loop iteration cap. Default 10. */
  maxIterations?: number;
  /** Per-loop wall-clock budget. Default 30_000ms. */
  maxWallMs?: number;
  /** How many recent memory facts to inject into the system prompt. Default 10. */
  memoryTopN?: number;
  /** How many recent messages to include as context. Default 6. */
  recentMessagesCount?: number;
}

export interface SubmitMessageInput {
  userId: string;
  channel: Channel;
  text: string;
  eventId?: string;
}

export interface SubmitMessageResult {
  replyText: string;
  eventId?: string;
  loop: LoopResult;
}

export interface AddManualEventInput {
  userId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  notes?: string;
}

export interface UpdateManualEventInput {
  userId: string;
  eventId: string;
  title?: string;
  startAt?: Date;
  endAt?: Date;
  notes?: string;
}

export interface MarkEventStatusInput {
  userId: string;
  eventId: string;
  status: EventStatus;
  userReplyText?: string;
  notes?: string;
}

const PRE_PING_LEAD_MS = 5 * 60_000;

export class LifeAgentSDK {
  private readonly db: Db;
  private readonly brain: Brain;
  private readonly tools: ToolRegistry;
  private readonly hooks: HookBus;
  private readonly skills: SkillLoader;
  private readonly cron: CronScheduler;
  private readonly memory: MemoryStore;
  private readonly loop: AgentLoop;
  private readonly memoryTopN: number;
  private readonly recentMessagesCount: number;

  constructor(opts: SDKOpts) {
    this.db = opts.db;
    this.brain = opts.brain;
    this.tools = opts.tools;
    this.hooks = opts.hooks;
    this.skills = opts.skills;
    this.cron = opts.cron;
    this.memory = opts.memory;
    this.memoryTopN = opts.memoryTopN ?? 10;
    this.recentMessagesCount = opts.recentMessagesCount ?? 6;
    this.loop = new AgentLoop({
      brain: opts.brain,
      tools: opts.tools,
      hooks: opts.hooks,
      maxIterations: opts.maxIterations,
      maxWallMs: opts.maxWallMs,
    });
  }

  async submitUserMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    await appendMessage(this.db, {
      userId: input.userId,
      role: "user",
      channel: input.channel,
      content: input.text,
      relatedEventId: input.eventId,
    });

    const system = await this.buildSystemPrompt(input.userId);

    const loopResult = await this.loop.run({
      system,
      userMessage: input.text,
      userId: input.userId,
      eventId: input.eventId,
    });

    await appendMessage(this.db, {
      userId: input.userId,
      role: "agent",
      channel: input.channel,
      content: loopResult.finalText,
      relatedEventId: input.eventId,
    });

    return {
      replyText: loopResult.finalText,
      eventId: input.eventId,
      loop: loopResult,
    };
  }

  async addManualEvent(input: AddManualEventInput): Promise<{ eventId: string }> {
    const prePingAt = new Date(input.startAt.getTime() - PRE_PING_LEAD_MS);
    const postPingAt = input.endAt;
    const ev = await createEvent(this.db, {
      userId: input.userId,
      source: "manual",
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      notes: input.notes,
      prePingAt,
      postPingAt,
    });

    await this.cron.schedule({
      userId: input.userId,
      kind: "pre_ping",
      nextRunAt: prePingAt,
      payload: { eventId: ev.id },
    });
    await this.cron.schedule({
      userId: input.userId,
      kind: "post_ping",
      nextRunAt: postPingAt,
      payload: { eventId: ev.id },
    });

    return { eventId: ev.id };
  }

  /**
   * Update a manual event. If startAt/endAt change, any active pre/post ping
   * cron jobs for this event are cancelled and replaced — but only for pings
   * that have not already fired and whose new firing time is in the future.
   */
  async updateManualEvent(input: UpdateManualEventInput): Promise<{ event: Event }> {
    const existing = await getEventById(this.db, input.eventId);
    if (!existing) throw new Error(`updateManualEvent: event ${input.eventId} not found`);
    if (existing.userId !== input.userId) {
      throw new Error(
        `updateManualEvent: event ${input.eventId} does not belong to user ${input.userId}`,
      );
    }
    if (existing.source !== "manual") {
      throw new Error(`updateManualEvent: cannot update event with source=${existing.source}`);
    }
    if (
      input.title === undefined &&
      input.startAt === undefined &&
      input.endAt === undefined &&
      input.notes === undefined
    ) {
      throw new Error("updateManualEvent: at least one field must be provided");
    }

    const newStartAt = input.startAt ?? existing.startAt;
    const newEndAt = input.endAt ?? existing.endAt;
    if (newEndAt.getTime() <= newStartAt.getTime()) {
      throw new Error("updateManualEvent: endAt must be after startAt");
    }

    const startChanged =
      input.startAt !== undefined && input.startAt.getTime() !== existing.startAt.getTime();
    const endChanged =
      input.endAt !== undefined && input.endAt.getTime() !== existing.endAt.getTime();

    const newPrePingAt = startChanged
      ? new Date(newStartAt.getTime() - PRE_PING_LEAD_MS)
      : undefined;
    const newPostPingAt = endChanged ? newEndAt : undefined;

    const patch: Parameters<typeof updateEvent>[2] = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (startChanged) {
      patch.startAt = newStartAt;
      patch.prePingAt = existing.prePingSentAt ? null : (newPrePingAt ?? null);
    }
    if (endChanged) {
      patch.endAt = newEndAt;
      patch.postPingAt = existing.postPingSentAt ? null : (newPostPingAt ?? null);
    }
    const updated = await updateEvent(this.db, input.eventId, patch);
    if (!updated) throw new Error("updateManualEvent: row vanished mid-update");

    if (startChanged) {
      await this.replaceCronJob({
        eventId: input.eventId,
        userId: input.userId,
        kind: "pre_ping",
        alreadySent: existing.prePingSentAt !== null,
        nextRunAt: newPrePingAt,
      });
    }
    if (endChanged) {
      await this.replaceCronJob({
        eventId: input.eventId,
        userId: input.userId,
        kind: "post_ping",
        alreadySent: existing.postPingSentAt !== null,
        nextRunAt: newPostPingAt,
      });
    }

    return { event: updated };
  }

  async markEventStatus(input: MarkEventStatusInput): Promise<{ event: Event }> {
    const existing = await getEventById(this.db, input.eventId);
    if (!existing) throw new Error(`markEventStatus: event ${input.eventId} not found`);
    if (existing.userId !== input.userId) {
      throw new Error(
        `markEventStatus: event ${input.eventId} does not belong to user ${input.userId}`,
      );
    }
    const updated = await updateEventStatus(this.db, input.eventId, input.status, {
      userReplyText: input.userReplyText,
      notes: input.notes,
    });
    if (!updated) throw new Error("markEventStatus: row vanished mid-update");
    return { event: updated };
  }

  private async replaceCronJob(opts: {
    eventId: string;
    userId: string;
    kind: "pre_ping" | "post_ping";
    alreadySent: boolean;
    nextRunAt: Date | undefined;
  }): Promise<void> {
    const existing = await getActiveCronJobsByEventId(this.db, opts.eventId, opts.kind);
    for (const job of existing) {
      await this.cron.cancel(job.id);
    }
    if (opts.alreadySent) return;
    if (!opts.nextRunAt) return;
    if (opts.nextRunAt.getTime() <= Date.now()) return;
    await this.cron.schedule({
      userId: opts.userId,
      kind: opts.kind,
      nextRunAt: opts.nextRunAt,
      payload: { eventId: opts.eventId },
    });
  }

  getDayPlan(userId: string, day: Date): Promise<Event[]> {
    return getEventsForDay(this.db, userId, day);
  }

  async runCron(jobId: string): Promise<void> {
    await this.cron.runJob(jobId);
  }

  async start(): Promise<void> {
    await this.cron.start();
  }

  async stop(): Promise<void> {
    await this.cron.stop();
  }

  private async buildSystemPrompt(userId: string): Promise<string> {
    const sections: string[] = [];
    const persona = this.skills.findByName("lifeagent");
    if (persona) {
      sections.push(persona.body.trim());
    }

    const facts = await this.memory.topRecent(userId, this.memoryTopN);
    if (facts.length > 0) {
      const factLines = facts.map((f) => `- (${f.kind}) ${f.body}`).join("\n");
      sections.push(`# Memory\n${factLines}`);
    }

    const recent = await recentMessages(this.db, userId, this.recentMessagesCount);
    if (recent.length > 0) {
      const lines = recent
        .slice()
        .reverse()
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      sections.push(`# Recent conversation\n${lines}`);
    }

    // Reference the unused `tools` and `hooks` so future expansion (e.g. tool
    // catalogue summary in the system prompt) has a discoverable home; for now
    // the loop receives them directly.
    void this.tools;
    void this.hooks;

    return sections.join("\n\n");
  }
}
