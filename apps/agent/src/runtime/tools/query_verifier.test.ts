import { beforeEach, describe, expect, it } from "bun:test";
import {
  type Db,
  createEvent,
  createUser,
  getVerificationsForEvent,
  makeTestDb,
} from "@lifeagent/db";
import type { ActivityClaim, VerificationResult, Verifier } from "../../verifiers/types";
import { ToolRegistry } from "../tools";
import { createQueryVerifierTool } from "./query_verifier";

class StubVerifier implements Verifier {
  readonly name: string;
  public lastClaim: ActivityClaim | null = null;
  constructor(
    name: string,
    private readonly result: VerificationResult,
  ) {
    this.name = name;
  }
  async authenticate(): Promise<void> {}
  async verify(claim: ActivityClaim): Promise<VerificationResult> {
    this.lastClaim = claim;
    return this.result;
  }
}

describe("query_verifier tool", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("dispatches to the named verifier and persists a verification_runs row", async () => {
    const user = await createUser(db, { telegramId: "tg_qv_1" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "lift",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });

    const stub = new StubVerifier("strava", {
      verifier: "strava",
      consistent: true,
      confidence: 0.9,
      summary: "1 activity overlapped",
      evidence: { activities: [{ id: 1 }] },
    });
    const reg = new ToolRegistry();
    reg.register(
      createQueryVerifierTool({
        db,
        verifiers: new Map([["strava", stub]]),
      }),
    );

    const out = (await reg.dispatch(
      "query_verifier",
      {
        verifier: "strava",
        eventId: event.id,
        kind: "exercise",
        windowStart: event.startAt.toISOString(),
        windowEnd: event.endAt.toISOString(),
        reportedStatus: "done",
      },
      { userId: user.id, eventId: event.id },
    )) as { consistent: boolean; verificationRunId: string };

    expect(out.consistent).toBe(true);
    expect(stub.lastClaim?.eventId).toBe(event.id);
    expect(stub.lastClaim?.userId).toBe(user.id);

    const runs = await getVerificationsForEvent(db, event.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(out.verificationRunId);
    expect(runs[0]?.verifier).toBe("strava");
    expect(runs[0]?.consistent).toBe(true);
  });

  it("throws on unknown verifier", async () => {
    const user = await createUser(db, { telegramId: "tg_qv_2" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "x",
      startAt: new Date(),
      endAt: new Date(Date.now() + 60_000),
    });
    const reg = new ToolRegistry();
    reg.register(createQueryVerifierTool({ db, verifiers: new Map() }));

    await expect(
      reg.dispatch(
        "query_verifier",
        {
          verifier: "ghosts",
          eventId: event.id,
          kind: "exercise",
          windowStart: event.startAt.toISOString(),
          windowEnd: event.endAt.toISOString(),
          reportedStatus: "done",
        },
        { userId: user.id, eventId: event.id },
      ),
    ).rejects.toThrow(/unknown verifier/);
  });
});
