import {
  type Db,
  type Event,
  createEvent,
  getEventByExternalId,
  getEventById,
  updateEvent,
} from "@lifeagent/db";
import type { DateRange, EventDelta, EventPatch, SourceAdapter } from "../source";
import { type FetchLike, type GcalCredentials, ensureFresh } from "./oauth";

export interface GcalAdapterDeps {
  db: Db;
  /** Returns user's stored credentials. The adapter calls ensureFresh under the hood. */
  loadCredentials: (userId: string) => Promise<GcalCredentials>;
  /** Persists refreshed credentials so the new access token is reused. */
  saveCredentials?: (userId: string, creds: GcalCredentials) => Promise<void>;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Calendar id. Default 'primary'. */
  calendarId?: string;
}

interface GcalEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  status?: "confirmed" | "tentative" | "cancelled";
}

interface GcalListResponse {
  items: GcalEvent[];
  nextPageToken?: string;
}

const SOURCE = "gcal";

export class GcalAdapter implements SourceAdapter {
  readonly name = SOURCE;
  private readonly deps: GcalAdapterDeps;

  constructor(deps: GcalAdapterDeps) {
    this.deps = deps;
  }

  async authenticate(userId: string): Promise<void> {
    const creds = await this.deps.loadCredentials(userId);
    const fresh = await ensureFresh({
      current: creds,
      clientId: this.deps.clientId,
      clientSecret: this.deps.clientSecret,
      fetch: this.deps.fetch,
    });
    if (fresh.accessToken !== creds.accessToken && this.deps.saveCredentials) {
      await this.deps.saveCredentials(userId, fresh);
    }
  }

  async syncEvents(userId: string, range: DateRange): Promise<EventDelta[]> {
    const creds = await this.fresh(userId);
    const calendarId = encodeURIComponent(this.deps.calendarId ?? "primary");
    const baseUrl = this.deps.baseUrl ?? "https://www.googleapis.com";
    const url = `${baseUrl}/calendar/v3/calendars/${calendarId}/events?timeMin=${range.start.toISOString()}&timeMax=${range.end.toISOString()}&singleEvents=true&orderBy=startTime`;
    const fetchImpl = this.deps.fetch ?? fetch;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`gcal syncEvents: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as GcalListResponse;
    const deltas: EventDelta[] = [];
    for (const item of body.items) {
      const startAt = parseDate(item.start);
      const endAt = parseDate(item.end);
      if (!startAt || !endAt) continue;
      const existing = await getEventByExternalId(this.deps.db, userId, SOURCE, item.id);
      if (item.status === "cancelled" && existing) {
        deltas.push({ kind: "delete", event: existing });
        continue;
      }
      const title = item.summary?.trim() || "(untitled)";
      const notes = item.description?.trim();
      let stored: Event;
      if (existing) {
        const updated = await updateEvent(this.deps.db, existing.id, {
          title,
          startAt,
          endAt,
          notes: notes ?? existing.notes ?? undefined,
        });
        stored = updated ?? existing;
      } else {
        stored = await createEvent(this.deps.db, {
          userId,
          source: SOURCE,
          externalId: item.id,
          title,
          startAt,
          endAt,
          notes,
        });
      }
      deltas.push({ kind: "upsert", event: stored });
    }
    return deltas;
  }

  async pushUpdate(userId: string, eventId: string, patch: EventPatch): Promise<void> {
    const event = await getEventById(this.deps.db, eventId);
    if (!event) throw new Error(`gcal pushUpdate: event ${eventId} not found`);
    if (event.userId !== userId) {
      throw new Error(`gcal pushUpdate: event ${eventId} does not belong to user ${userId}`);
    }
    if (event.source !== SOURCE) {
      throw new Error(`gcal pushUpdate: cannot patch source=${event.source}`);
    }
    if (!event.externalId) {
      throw new Error(`gcal pushUpdate: event ${eventId} has no externalId`);
    }

    const creds = await this.fresh(userId);
    const calendarId = encodeURIComponent(this.deps.calendarId ?? "primary");
    const baseUrl = this.deps.baseUrl ?? "https://www.googleapis.com";
    const url = `${baseUrl}/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(event.externalId)}`;
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.notes !== undefined) body.description = patch.notes;
    if (patch.startAt !== undefined) body.start = { dateTime: patch.startAt.toISOString() };
    if (patch.endAt !== undefined) body.end = { dateTime: patch.endAt.toISOString() };

    const fetchImpl = this.deps.fetch ?? fetch;
    const res = await fetchImpl(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`gcal pushUpdate: ${res.status} ${await res.text()}`);
    }
    // Mirror the patch locally too
    await updateEvent(this.deps.db, eventId, patch);
  }

  private async fresh(userId: string): Promise<GcalCredentials> {
    const creds = await this.deps.loadCredentials(userId);
    const fresh = await ensureFresh({
      current: creds,
      clientId: this.deps.clientId,
      clientSecret: this.deps.clientSecret,
      fetch: this.deps.fetch,
    });
    if (fresh.accessToken !== creds.accessToken && this.deps.saveCredentials) {
      await this.deps.saveCredentials(userId, fresh);
    }
    return fresh;
  }
}

function parseDate(node: { dateTime?: string; date?: string }): Date | null {
  if (node.dateTime) return new Date(node.dateTime);
  if (node.date) return new Date(`${node.date}T00:00:00Z`);
  return null;
}
