import { describe, expect, it } from "bun:test";
import type { ActivityClaim } from "./types";
import { WakatimeVerifier } from "./wakatime";

function makeClaim(overrides: Partial<ActivityClaim> = {}): ActivityClaim {
  return {
    eventId: "00000000-0000-0000-0000-000000000010",
    userId: "00000000-0000-0000-0000-000000000020",
    kind: "code",
    windowStart: new Date("2026-05-04T15:00:00Z"),
    windowEnd: new Date("2026-05-04T17:00:00Z"),
    reportedStatus: "done",
    ...overrides,
  };
}

function makeFetch(body: unknown, status = 200) {
  return async (_url: string, _init?: RequestInit): Promise<Response> => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("WakatimeVerifier", () => {
  it("returns consistent=true when coding seconds exceed threshold", async () => {
    const v = new WakatimeVerifier({
      getApiKey: async () => "k",
      fetch: makeFetch({
        data: [
          {
            range: { date: "2026-05-04" },
            categories: [{ name: "Coding", total_seconds: 1800 }],
          },
        ],
      }),
      thresholdSeconds: 600,
    });
    const r = await v.verify(makeClaim());
    expect(r.consistent).toBe(true);
    expect(r.summary).toContain("min coding");
  });

  it("returns consistent=false when below threshold", async () => {
    const v = new WakatimeVerifier({
      getApiKey: async () => "k",
      fetch: makeFetch({
        data: [
          {
            range: { date: "2026-05-04" },
            categories: [{ name: "Coding", total_seconds: 60 }],
          },
        ],
      }),
      thresholdSeconds: 300,
    });
    const r = await v.verify(makeClaim());
    expect(r.consistent).toBe(false);
    expect(r.summary).toContain("only");
  });

  it("returns inconclusive on api error", async () => {
    const v = new WakatimeVerifier({
      getApiKey: async () => "k",
      fetch: makeFetch({}, 500),
    });
    const r = await v.verify(makeClaim());
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("returns inconclusive for non-code/study/focus kinds", async () => {
    const v = new WakatimeVerifier({
      getApiKey: async () => "k",
      fetch: makeFetch({}),
    });
    const r = await v.verify(makeClaim({ kind: "exercise" }));
    expect(r.confidence).toBe(0);
  });

  it("handles 'study' and 'focus' kinds the same as code", async () => {
    const v = new WakatimeVerifier({
      getApiKey: async () => "k",
      fetch: makeFetch({
        data: [
          {
            range: { date: "2026-05-04" },
            categories: [{ name: "Coding", total_seconds: 2000 }],
          },
        ],
      }),
      thresholdSeconds: 300,
    });
    const study = await v.verify(makeClaim({ kind: "study" }));
    const focus = await v.verify(makeClaim({ kind: "focus" }));
    expect(study.consistent).toBe(true);
    expect(focus.consistent).toBe(true);
  });
});
