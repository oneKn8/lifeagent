import {
  type Db,
  type Event,
  getEventById,
  getEventsBySourceInRange,
  updateEvent,
} from "@lifeagent/db";

export interface DateRange {
  start: Date;
  end: Date;
}

export interface EventPatch {
  title?: string;
  startAt?: Date;
  endAt?: Date;
  notes?: string;
}

export interface EventDelta {
  kind: "upsert" | "delete";
  event: Event;
}

export interface SourceAdapter {
  readonly name: string;
  authenticate(userId: string): Promise<void>;
  syncEvents(userId: string, range: DateRange): Promise<EventDelta[]>;
  pushUpdate(userId: string, eventId: string, patch: EventPatch): Promise<void>;
}

const MANUAL_SOURCE = "manual";

export class ManualAdapter implements SourceAdapter {
  readonly name = MANUAL_SOURCE;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async authenticate(_userId: string): Promise<void> {
    // Manual entry has no oauth handshake. Intentionally a no-op.
  }

  async syncEvents(userId: string, range: DateRange): Promise<EventDelta[]> {
    const rows = await getEventsBySourceInRange(this.db, userId, MANUAL_SOURCE, range);
    return rows.map((event) => ({ kind: "upsert" as const, event }));
  }

  async pushUpdate(userId: string, eventId: string, patch: EventPatch): Promise<void> {
    const existing = await getEventById(this.db, eventId);
    if (!existing) throw new Error(`pushUpdate: event ${eventId} not found`);
    if (existing.userId !== userId) {
      throw new Error(`pushUpdate: event ${eventId} does not belong to user ${userId}`);
    }
    if (existing.source !== MANUAL_SOURCE) {
      throw new Error(
        `pushUpdate: ManualAdapter cannot modify event with source=${existing.source}`,
      );
    }
    await updateEvent(this.db, eventId, patch);
  }
}
