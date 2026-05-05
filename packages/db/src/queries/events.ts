import { and, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { events } from "../schema";

export type Event = typeof events.$inferSelect;
export type EventStatus = Event["status"];
export type VerificationStatusValue = Event["verificationStatus"];

export interface CreateEventInput {
  userId: string;
  source: string;
  externalId?: string;
  title: string;
  startAt: Date;
  endAt: Date;
  status?: EventStatus;
  prePingAt?: Date;
  postPingAt?: Date;
  parsedState?: unknown;
  notes?: string;
}

export async function createEvent(db: Db, input: CreateEventInput): Promise<Event> {
  const [row] = await db
    .insert(events)
    .values({
      userId: input.userId,
      source: input.source,
      externalId: input.externalId,
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      status: input.status,
      prePingAt: input.prePingAt,
      postPingAt: input.postPingAt,
      parsedState: input.parsedState as never,
      notes: input.notes,
    })
    .returning();
  if (!row) throw new Error("createEvent: insert returned no row");
  return row;
}

export async function getEventById(db: Db, id: string): Promise<Event | null> {
  const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Returns events for the user where the start_at falls within the UTC day
 * specified by `day` (anchored at midnight UTC).
 */
export async function getEventsForDay(db: Db, userId: string, day: Date): Promise<Event[]> {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), gte(events.startAt, start), lt(events.startAt, end)));
}

/**
 * Events for a user with the given source whose start_at falls in [start, end).
 */
export async function getEventsBySourceInRange(
  db: Db,
  userId: string,
  source: string,
  range: { start: Date; end: Date },
): Promise<Event[]> {
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.source, source),
        gte(events.startAt, range.start),
        lt(events.startAt, range.end),
      ),
    );
}

export interface UpdateEventStatusExtras {
  userReplyText?: string;
  notes?: string;
  parsedState?: unknown;
  verificationStatus?: VerificationStatusValue;
  prePingSentAt?: Date;
  postPingSentAt?: Date;
}

export async function updateEventStatus(
  db: Db,
  id: string,
  status: EventStatus,
  extras: UpdateEventStatusExtras = {},
): Promise<Event | null> {
  const [row] = await db
    .update(events)
    .set({
      status,
      userReplyText: extras.userReplyText,
      notes: extras.notes,
      parsedState: extras.parsedState as never,
      verificationStatus: extras.verificationStatus,
      prePingSentAt: extras.prePingSentAt,
      postPingSentAt: extras.postPingSentAt,
      updatedAt: sql`now()`,
    })
    .where(eq(events.id, id))
    .returning();
  return row ?? null;
}

export interface UpdateEventPatch {
  title?: string;
  startAt?: Date;
  endAt?: Date;
  notes?: string;
  prePingAt?: Date | null;
  postPingAt?: Date | null;
}

/**
 * Generic partial update for an event's mutable fields. Returns null if the
 * event id does not exist. Pings are nullable so a re-schedule can clear them.
 */
export async function updateEvent(
  db: Db,
  id: string,
  patch: UpdateEventPatch,
): Promise<Event | null> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.startAt !== undefined) set.startAt = patch.startAt;
  if (patch.endAt !== undefined) set.endAt = patch.endAt;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.prePingAt !== undefined) set.prePingAt = patch.prePingAt;
  if (patch.postPingAt !== undefined) set.postPingAt = patch.postPingAt;
  const [row] = await db.update(events).set(set).where(eq(events.id, id)).returning();
  return row ?? null;
}

/**
 * Events whose pre_ping_at <= beforeTime, where pre_ping_sent_at is still null.
 */
export async function getUpcomingEventsNeedingPings(db: Db, beforeTime: Date): Promise<Event[]> {
  return db
    .select()
    .from(events)
    .where(
      and(
        isNotNull(events.prePingAt),
        isNull(events.prePingSentAt),
        lte(events.prePingAt, beforeTime),
      ),
    );
}
