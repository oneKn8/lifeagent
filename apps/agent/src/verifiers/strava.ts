import type { ActivityClaim, VerificationResult, Verifier } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface StravaCredentials {
  accessToken: string;
  /** Optional: when the access token expires (ms epoch). */
  expiresAt?: number;
  refreshToken?: string;
}

export interface StravaVerifierOptions {
  /** Returns the credentials for a user; should refresh access token if needed. */
  getCredentials: (userId: string) => Promise<StravaCredentials>;
  /** Inject a fetch impl for tests. Defaults to global fetch. */
  fetch?: FetchLike;
  /** Strava API host. Default https://www.strava.com */
  baseUrl?: string;
}

interface StravaActivity {
  id: number;
  name: string;
  start_date: string; // ISO timestamp
  elapsed_time: number; // seconds
  type: string;
}

export class StravaVerifier implements Verifier {
  readonly name = "strava";
  private readonly getCredentials: StravaVerifierOptions["getCredentials"];
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(opts: StravaVerifierOptions) {
    this.getCredentials = opts.getCredentials;
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://www.strava.com";
  }

  async authenticate(userId: string): Promise<void> {
    await this.getCredentials(userId);
  }

  async verify(claim: ActivityClaim): Promise<VerificationResult> {
    if (claim.kind !== "exercise") {
      return {
        verifier: this.name,
        evidence: null,
        consistent: true,
        confidence: 0,
        summary: `strava does not verify kind=${claim.kind}; inconclusive`,
      };
    }

    const creds = await this.getCredentials(claim.userId);
    const after = Math.floor(claim.windowStart.getTime() / 1000);
    const before = Math.floor(claim.windowEnd.getTime() / 1000);
    const url = `${this.baseUrl}/api/v3/athlete/activities?after=${after}&before=${before}&per_page=30`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!res.ok) {
      const body = await safeText(res);
      return {
        verifier: this.name,
        evidence: { status: res.status, body },
        consistent: claim.reportedStatus !== "done",
        confidence: 0.1,
        summary: `strava api error ${res.status}; treating as inconclusive`,
      };
    }
    const activities = (await res.json()) as StravaActivity[];

    const overlapping = activities.filter((a) => {
      const start = new Date(a.start_date).getTime();
      const end = start + a.elapsed_time * 1000;
      return start < claim.windowEnd.getTime() && end > claim.windowStart.getTime();
    });

    if (claim.reportedStatus === "done" || claim.reportedStatus === "partial") {
      const consistent = overlapping.length > 0;
      return {
        verifier: this.name,
        evidence: { activities: overlapping },
        consistent,
        confidence: consistent ? 0.95 : 0.85,
        summary: consistent
          ? `${overlapping.length} strava activity overlapped the window`
          : "no strava activity overlapped the window",
      };
    }

    // skipped: consistent only if no activity overlaps.
    const consistent = overlapping.length === 0;
    return {
      verifier: this.name,
      evidence: { activities: overlapping },
      consistent,
      confidence: consistent ? 0.9 : 0.85,
      summary: consistent
        ? "user reported skipped and no activity was found"
        : `user reported skipped but ${overlapping.length} activity overlapped`,
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
