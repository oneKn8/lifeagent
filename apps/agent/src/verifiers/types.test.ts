import { describe, expect, it } from "bun:test";
import type { ActivityClaim, VerificationResult, Verifier } from "./types";

describe("Verifier types", () => {
  it("a no-op verifier satisfies the interface", async () => {
    const v: Verifier = {
      name: "noop",
      authenticate: async () => {},
      verify: async (claim: ActivityClaim): Promise<VerificationResult> => ({
        verifier: "noop",
        evidence: { received: claim.eventId },
        consistent: true,
        confidence: 0,
        summary: "no-op",
      }),
    };

    const result = await v.verify({
      eventId: "00000000-0000-0000-0000-000000000000",
      userId: "00000000-0000-0000-0000-000000000001",
      kind: "exercise",
      windowStart: new Date(),
      windowEnd: new Date(),
      reportedStatus: "done",
    });
    expect(result.verifier).toBe("noop");
    expect(result.consistent).toBe(true);
  });
});
