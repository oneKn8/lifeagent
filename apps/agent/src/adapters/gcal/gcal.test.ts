import { beforeEach, describe, expect, it } from "bun:test";
import {
  type Db,
  createEvent,
  createUser,
  getEventByExternalId,
  getEventById,
  makeTestDb,
} from "@lifeagent/db";
import { GcalAdapter } from "./index";
import type { GcalCredentials } from "./oauth";

function makeFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  let i = 0;
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
    });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    if (!handler) throw new Error("no handler");
    const res = handler(url, init);
    i += 1;
    return res;
  };
  return { fetch: fn, calls };
}

const FRESH_CREDS: GcalCredentials = {
  accessToken: "AT",
  refreshToken: "RT",
  expiresAt: Date.now() + 60 * 60_000,
  scopes: ["calendar.events"],
};

describe("GcalAdapter", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("syncEvents inserts new events with source=gcal and externalId", async () => {
    const user = await createUser(db, { telegramId: "tg_g_1" });
    const { fetch: f, calls } = makeFetch([
      () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "g1",
                summary: "lift",
                start: { dateTime: "2026-05-04T15:00:00Z" },
                end: { dateTime: "2026-05-04T16:00:00Z" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ]);
    const adapter = new GcalAdapter({
      db,
      loadCredentials: async () => FRESH_CREDS,
      clientId: "cid",
      clientSecret: "csec",
      fetch: f,
    });
    const deltas = await adapter.syncEvents(user.id, {
      start: new Date("2026-05-04T00:00:00Z"),
      end: new Date("2026-05-05T00:00:00Z"),
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.kind).toBe("upsert");
    const stored = await getEventByExternalId(db, user.id, "gcal", "g1");
    expect(stored?.title).toBe("lift");
    expect(calls[0]?.url).toContain("calendars/primary/events");
  });

  it("syncEvents updates existing event by externalId", async () => {
    const user = await createUser(db, { telegramId: "tg_g_2" });
    await createEvent(db, {
      userId: user.id,
      source: "gcal",
      externalId: "g2",
      title: "old title",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const { fetch: f } = makeFetch([
      () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "g2",
                summary: "new title",
                start: { dateTime: "2026-05-04T15:30:00Z" },
                end: { dateTime: "2026-05-04T16:30:00Z" },
              },
            ],
          }),
          { status: 200 },
        ),
    ]);
    const adapter = new GcalAdapter({
      db,
      loadCredentials: async () => FRESH_CREDS,
      clientId: "cid",
      clientSecret: "csec",
      fetch: f,
    });
    await adapter.syncEvents(user.id, {
      start: new Date("2026-05-04T00:00:00Z"),
      end: new Date("2026-05-05T00:00:00Z"),
    });
    const stored = await getEventByExternalId(db, user.id, "gcal", "g2");
    expect(stored?.title).toBe("new title");
    expect(stored?.startAt.toISOString()).toBe("2026-05-04T15:30:00.000Z");
  });

  it("pushUpdate sends a PATCH and mirrors locally", async () => {
    const user = await createUser(db, { telegramId: "tg_g_3" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "gcal",
      externalId: "g3",
      title: "original",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const { fetch: f, calls } = makeFetch([() => new Response("{}", { status: 200 })]);
    const adapter = new GcalAdapter({
      db,
      loadCredentials: async () => FRESH_CREDS,
      clientId: "cid",
      clientSecret: "csec",
      fetch: f,
    });
    await adapter.pushUpdate(user.id, event.id, {
      title: "renamed",
      startAt: new Date("2026-05-04T15:30:00Z"),
    });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toContain("renamed");
    const after = await getEventById(db, event.id);
    expect(after?.title).toBe("renamed");
  });

  it("syncEvents marks delete delta when status=cancelled", async () => {
    const user = await createUser(db, { telegramId: "tg_g_4" });
    await createEvent(db, {
      userId: user.id,
      source: "gcal",
      externalId: "g4",
      title: "doomed",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const { fetch: f } = makeFetch([
      () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "g4",
                status: "cancelled",
                start: { dateTime: "2026-05-04T15:00:00Z" },
                end: { dateTime: "2026-05-04T16:00:00Z" },
              },
            ],
          }),
          { status: 200 },
        ),
    ]);
    const adapter = new GcalAdapter({
      db,
      loadCredentials: async () => FRESH_CREDS,
      clientId: "cid",
      clientSecret: "csec",
      fetch: f,
    });
    const deltas = await adapter.syncEvents(user.id, {
      start: new Date("2026-05-04T00:00:00Z"),
      end: new Date("2026-05-05T00:00:00Z"),
    });
    expect(deltas[0]?.kind).toBe("delete");
  });

  it("ensures the access token is refreshed transparently when near expiry", async () => {
    const user = await createUser(db, { telegramId: "tg_g_5" });
    const stale: GcalCredentials = {
      accessToken: "old",
      refreshToken: "RT",
      expiresAt: Date.now() + 1000,
      scopes: ["calendar.events"],
    };
    let saved: GcalCredentials | null = null;
    const { fetch: f, calls } = makeFetch([
      // first call is the refresh
      () =>
        new Response(
          JSON.stringify({
            access_token: "fresh",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "calendar.events",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      // second is the events list
      () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]);
    const adapter = new GcalAdapter({
      db,
      loadCredentials: async () => stale,
      saveCredentials: async (_uid, c) => {
        saved = c;
      },
      clientId: "cid",
      clientSecret: "csec",
      fetch: f,
    });
    await adapter.syncEvents(user.id, {
      start: new Date("2026-05-04T00:00:00Z"),
      end: new Date("2026-05-05T00:00:00Z"),
    });
    expect(calls[0]?.url).toContain("oauth2.googleapis.com/token");
    expect(calls[1]?.url).toContain("calendars/primary/events");
    const finalAuth = (calls[1] as unknown as { url: string }).url;
    expect(finalAuth).toBeDefined();
    expect(saved?.accessToken).toBe("fresh");
  });
});
