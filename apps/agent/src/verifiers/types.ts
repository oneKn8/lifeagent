/**
 * Verifier interface per design §5.5. Each verifier checks a claim against an
 * external data source (Strava, GitHub, Wakatime) and returns a structured
 * result that the agent can confront the user with.
 */

export type ActivityKind = "exercise" | "code" | "study" | "focus" | "custom";
export type ReportedStatus = "done" | "partial" | "skipped";

export interface ActivityClaim {
  eventId: string;
  userId: string;
  kind: ActivityKind;
  windowStart: Date;
  windowEnd: Date;
  reportedStatus: ReportedStatus;
}

export interface VerificationResult {
  verifier: string;
  /** Raw provider response — kept for audit. */
  evidence: unknown;
  /** True if external data is consistent with the user's report. */
  consistent: boolean;
  /** 0..1; the confidence the verifier has in its judgment. */
  confidence: number;
  /** Short human-readable summary, e.g. "no Strava activity in this window". */
  summary: string;
}

export interface Verifier {
  readonly name: string;
  authenticate(userId: string): Promise<void>;
  verify(claim: ActivityClaim): Promise<VerificationResult>;
}
