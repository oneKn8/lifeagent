import { type Db, type Event, recordVerificationRun, updateEvent } from "@lifeagent/db";
import type {
  ActivityKind,
  ReportedStatus,
  VerificationResult,
  Verifier,
} from "../../verifiers/types";
import type { AgentLoop } from "../loop";

export interface ConfrontDeps {
  db: Db;
  verifiers: Map<ActivityKind, Verifier>;
  /** Optional. If supplied and verifier is inconsistent + confident, enqueue a follow-up. */
  loop?: AgentLoop;
  /** How to infer the activity kind from an event. Default: keyword-based on title + notes. */
  inferKind?: (event: Event) => ActivityKind | null;
  /** Confidence threshold to act on inconsistency. Default 0.7. */
  confrontThreshold?: number;
}

export interface ConfrontInput {
  event: Event;
  reportedStatus: ReportedStatus | "slipped";
}

export interface ConfrontOutput {
  verifierRan: boolean;
  consistent?: boolean;
  confidence?: number;
  verificationRunId?: string;
  confronted: boolean;
}

const DEFAULT_THRESHOLD = 0.7;

const KIND_KEYWORDS: Array<[ActivityKind, RegExp]> = [
  ["exercise", /\b(gym|lift|run|ride|swim|hike|workout|cardio|yoga|squat|deadlift|bench)\b/i],
  ["code", /\b(code|coding|refactor|ship|debug|build|merge|pr|deploy)\b/i],
  ["study", /\b(study|read|learn|book|chapter|paper)\b/i],
  ["focus", /\b(focus|deep work|deep-work|deepwork|writing)\b/i],
];

export function defaultInferKind(event: Event): ActivityKind | null {
  const blob = `${event.title} ${event.notes ?? ""}`;
  for (const [kind, re] of KIND_KEYWORDS) {
    if (re.test(blob)) return kind;
  }
  return null;
}

export function createConfrontStep(deps: ConfrontDeps) {
  const inferKind = deps.inferKind ?? defaultInferKind;
  const threshold = deps.confrontThreshold ?? DEFAULT_THRESHOLD;
  return async (input: ConfrontInput): Promise<ConfrontOutput> => {
    const reported = input.reportedStatus;
    if (reported === "slipped") {
      // Slipped is self-honest already; nothing to verify against.
      return { verifierRan: false, confronted: false };
    }

    const kind = inferKind(input.event);
    if (!kind) {
      return { verifierRan: false, confronted: false };
    }
    const verifier = deps.verifiers.get(kind);
    if (!verifier) {
      return { verifierRan: false, confronted: false };
    }

    let result: VerificationResult;
    try {
      result = await verifier.verify({
        eventId: input.event.id,
        userId: input.event.userId,
        kind,
        windowStart: input.event.startAt,
        windowEnd: input.event.endAt,
        reportedStatus: reported,
      });
    } catch (err) {
      // Don't crash the reply path on verifier failures.
      process.stderr.write(
        `confront: verifier ${verifier.name} threw: ${(err as Error).message}\n`,
      );
      return { verifierRan: true, confronted: false };
    }

    const run = await recordVerificationRun(deps.db, {
      userId: input.event.userId,
      eventId: input.event.id,
      verifier: result.verifier,
      consistent: result.consistent,
      confidence: result.confidence,
      summary: result.summary,
      evidence: result.evidence,
    });

    const newVerificationStatus = decideVerificationStatus(result, threshold);
    await updateEvent(deps.db, input.event.id, {
      verificationStatus: newVerificationStatus,
    });

    let confronted = false;
    if (deps.loop && result.consistent === false && result.confidence >= threshold) {
      const system = `You are lifeagent. The user's reply contradicts external evidence. Confront them factually using the verification_run id below. Do not moralize. End with a question.

# Verification
- verification_run.id: ${run.id}
- verifier: ${result.verifier}
- summary: ${result.summary}

# Event
- id: ${input.event.id}
- title: ${input.event.title}
- reported by user: ${reported}

Use the send_message tool to deliver the confrontation in two sentences max.`;
      await deps.loop.run({
        system,
        userMessage: "Send the confrontation now.",
        userId: input.event.userId,
        eventId: input.event.id,
      });
      confronted = true;
    }

    return {
      verifierRan: true,
      consistent: result.consistent,
      confidence: result.confidence,
      verificationRunId: run.id,
      confronted,
    };
  };
}

function decideVerificationStatus(
  result: VerificationResult,
  threshold: number,
): "consistent" | "contradicted" | "inconclusive" {
  if (result.confidence < threshold) return "inconclusive";
  return result.consistent ? "consistent" : "contradicted";
}
