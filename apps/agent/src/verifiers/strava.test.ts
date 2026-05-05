import { describe, expect, it } from "bun:test";
import { StravaVerifier } from "./strava";
import type { ActivityClaim } from "./types";

function makeClaim(overrides: Partial<ActivityClaim> = {}): ActivityClaim {
  return {
    eventId: "00000000-0000-0000-0000-000000000010",
    userId: "00000000-0000-0000-0000-000000000020",
    kind: "exercise",
    windowStart: new Date("2026-05-04T15:00:00Z"),
    windowEnd: new Date("2026-05-04T16:00:00Z"),
    reportedStatus: "done",
    ...overrides,
  };
}

function makeFetch(
  activities: unknown[],
  status = 200,
): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: Array<{ url: string; auth: string | null }>;
} {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    calls.push({ url, auth });
    return new Response(JSON.stringify(activities), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchFn, calls };
}

describe("StravaVerifier", () => {
  it("returns consistent=true when an activity overlaps the window for reported done", async () => {
    const { fetch: f, calls } = makeFetch([
      {
        id: 1,
        name: "lift",
        start_date: "2026-05-04T15:10:00Z",
        elapsed_time: 30 * 60,
        type: "WeightTraining",
      },
    ]);
    const v = new StravaVerifier({
      getCredentials: async () => ({ accessToken: "tok" }),
      fetch: f,
    });
    const r = await v.verify(makeClaim());
    expect(r.consistent).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(calls[0]?.auth).toBe("Bearer tok");
    expect(calls[0]?.url).toContain("after=");
  });

  it("returns consistent=false when no activity overlaps for reported done", async () => {
    const { fetch: f } = makeFetch([
      {
        id: 1,
        name: "morning ride",
        start_date: "2026-05-04T08:00:00Z",
        elapsed_time: 60 * 60,
        type: "Ride",
      },
    ]);
    const v = new StravaVerifier({
      getCredentials: async () => ({ accessToken: "tok" }),
      fetch: f,
    });
    const r = await v.verify(makeClaim());
    expect(r.consistent).toBe(false);
    expect(r.summary).toContain("no strava activity");
  });

  it("inverts logic for reported skipped", async () => {
    const { fetch: f } = makeFetch([
      {
        id: 1,
        name: "ride",
        start_date: "2026-05-04T15:10:00Z",
        elapsed_time: 30 * 60,
        type: "Ride",
      },
    ]);
    const v = new StravaVerifier({
      getCredentials: async () => ({ accessToken: "tok" }),
      fetch: f,
    });
    const r = await v.verify(makeClaim({ reportedStatus: "skipped" }));
    expect(r.consistent).toBe(false);
    expect(r.summary).toContain("skipped");
  });

  it("returns inconclusive for non-exercise kinds", async () => {
    const { fetch: f, calls } = makeFetch([]);
    const v = new StravaVerifier({
      getCredentials: async () => ({ accessToken: "tok" }),
      fetch: f,
    });
    const r = await v.verify(makeClaim({ kind: "code" }));
    expect(r.confidence).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("returns low confidence on api error", async () => {
    const { fetch: f } = makeFetch([], 401);
    const v = new StravaVerifier({
      getCredentials: async () => ({ accessToken: "tok" }),
      fetch: f,
    });
    const r = await v.verify(makeClaim());
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.summary).toContain("strava api error");
  });
});
