import { describe, expect, it } from "bun:test";
import { GithubVerifier } from "./github";
import type { ActivityClaim } from "./types";

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

describe("GithubVerifier", () => {
  it("returns consistent=true when commits land in the window for reported done", async () => {
    const v = new GithubVerifier({
      getToken: async () => "pat",
      fetch: makeFetch({
        data: {
          viewer: {
            contributionsCollection: {
              commitContributionsByRepository: [
                {
                  repository: { nameWithOwner: "oneKn8/lifeagent" },
                  contributions: { totalCount: 3 },
                },
              ],
            },
          },
        },
      }),
    });
    const r = await v.verify(makeClaim());
    expect(r.consistent).toBe(true);
    expect(r.summary).toContain("3 commit");
  });

  it("returns consistent=false when no commits land in window for reported done", async () => {
    const v = new GithubVerifier({
      getToken: async () => "pat",
      fetch: makeFetch({
        data: {
          viewer: {
            contributionsCollection: {
              commitContributionsByRepository: [],
            },
          },
        },
      }),
    });
    const r = await v.verify(makeClaim());
    expect(r.consistent).toBe(false);
    expect(r.summary).toContain("no commits");
  });

  it("returns inconclusive on api error", async () => {
    const v = new GithubVerifier({
      getToken: async () => "pat",
      fetch: makeFetch({}, 401),
    });
    const r = await v.verify(makeClaim());
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("returns inconclusive for non-code kinds", async () => {
    const v = new GithubVerifier({
      getToken: async () => "pat",
      fetch: makeFetch({}),
    });
    const r = await v.verify(makeClaim({ kind: "exercise" }));
    expect(r.confidence).toBe(0);
  });

  it("inverts logic for reported skipped", async () => {
    const v = new GithubVerifier({
      getToken: async () => "pat",
      fetch: makeFetch({
        data: {
          viewer: {
            contributionsCollection: {
              commitContributionsByRepository: [
                {
                  repository: { nameWithOwner: "x/y" },
                  contributions: { totalCount: 2 },
                },
              ],
            },
          },
        },
      }),
    });
    const r = await v.verify(makeClaim({ reportedStatus: "skipped" }));
    expect(r.consistent).toBe(false);
    expect(r.summary).toContain("skipped");
  });
});
