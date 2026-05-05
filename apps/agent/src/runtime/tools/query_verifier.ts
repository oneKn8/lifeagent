import { type Db, recordVerificationRun } from "@lifeagent/db";
import { z } from "zod";
import type { Verifier } from "../../verifiers/types";
import type { Tool } from "../tools";

export interface QueryVerifierDeps {
  db: Db;
  verifiers: Map<string, Verifier>;
}

const inputSchema = z.object({
  verifier: z.string().min(1),
  eventId: z.string().uuid(),
  kind: z.enum(["exercise", "code", "study", "focus", "custom"]),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  reportedStatus: z.enum(["done", "partial", "skipped"]),
});

export type QueryVerifierInput = z.infer<typeof inputSchema>;
export interface QueryVerifierOutput {
  verifier: string;
  consistent: boolean;
  confidence: number;
  summary: string;
  verificationRunId: string;
}

export function createQueryVerifierTool(
  deps: QueryVerifierDeps,
): Tool<QueryVerifierInput, QueryVerifierOutput> {
  return {
    name: "query_verifier",
    description:
      "Run a verifier (strava, github, wakatime) for an event window and persist the result. Returns the verification_runs row id so the agent can reference it when confronting.",
    inputSchema,
    async run({ input, userId }) {
      const verifier = deps.verifiers.get(input.verifier);
      if (!verifier) {
        throw new Error(`unknown verifier: ${input.verifier}`);
      }
      const result = await verifier.verify({
        eventId: input.eventId,
        userId,
        kind: input.kind,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        reportedStatus: input.reportedStatus,
      });
      const row = await recordVerificationRun(deps.db, {
        userId,
        eventId: input.eventId,
        verifier: result.verifier,
        consistent: result.consistent,
        confidence: result.confidence,
        summary: result.summary,
        evidence: result.evidence,
      });
      return {
        verifier: result.verifier,
        consistent: result.consistent,
        confidence: result.confidence,
        summary: result.summary,
        verificationRunId: row.id,
      };
    },
  };
}
