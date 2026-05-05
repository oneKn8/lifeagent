import type { ActivityClaim, VerificationResult, Verifier } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface WakatimeVerifierOptions {
  getApiKey: (userId: string) => Promise<string>;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Minimum coding seconds in window to count as activity. Default 300 (5 min). */
  thresholdSeconds?: number;
}

interface WakatimeSummary {
  data: Array<{
    range: { date: string };
    categories: Array<{ name: string; total_seconds: number }>;
  }>;
}

export class WakatimeVerifier implements Verifier {
  readonly name = "wakatime";
  private readonly getApiKey: WakatimeVerifierOptions["getApiKey"];
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly thresholdSeconds: number;

  constructor(opts: WakatimeVerifierOptions) {
    this.getApiKey = opts.getApiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://wakatime.com";
    this.thresholdSeconds = opts.thresholdSeconds ?? 300;
  }

  async authenticate(userId: string): Promise<void> {
    await this.getApiKey(userId);
  }

  async verify(claim: ActivityClaim): Promise<VerificationResult> {
    if (claim.kind !== "code" && claim.kind !== "study" && claim.kind !== "focus") {
      return {
        verifier: this.name,
        evidence: null,
        consistent: true,
        confidence: 0,
        summary: `wakatime does not verify kind=${claim.kind}; inconclusive`,
      };
    }
    const apiKey = await this.getApiKey(claim.userId);
    const start = isoDate(claim.windowStart);
    const end = isoDate(claim.windowEnd);
    const auth = `Basic ${base64UrlSafe(apiKey)}`;
    const url = `${this.baseUrl}/api/v1/users/current/summaries?start=${start}&end=${end}`;
    const res = await this.fetchImpl(url, { headers: { Authorization: auth } });
    if (!res.ok) {
      return {
        verifier: this.name,
        evidence: { status: res.status },
        consistent: claim.reportedStatus !== "done",
        confidence: 0.1,
        summary: `wakatime api error ${res.status}; inconclusive`,
      };
    }
    const body = (await res.json()) as WakatimeSummary;
    const codingSeconds = body.data.reduce((sum, day) => {
      const coding = day.categories.find((c) => c.name.toLowerCase() === "coding");
      return sum + (coding?.total_seconds ?? 0);
    }, 0);

    if (claim.reportedStatus === "done" || claim.reportedStatus === "partial") {
      const consistent = codingSeconds >= this.thresholdSeconds;
      return {
        verifier: this.name,
        evidence: { codingSeconds, threshold: this.thresholdSeconds },
        consistent,
        confidence: consistent ? 0.9 : 0.85,
        summary: consistent
          ? `${Math.round(codingSeconds / 60)} min coding in window`
          : `only ${Math.round(codingSeconds / 60)} min coding (threshold ${Math.round(
              this.thresholdSeconds / 60,
            )})`,
      };
    }

    const consistent = codingSeconds < this.thresholdSeconds;
    return {
      verifier: this.name,
      evidence: { codingSeconds, threshold: this.thresholdSeconds },
      consistent,
      confidence: consistent ? 0.9 : 0.85,
      summary: consistent
        ? "user reported skipped and no significant coding was found"
        : `user reported skipped but ${Math.round(codingSeconds / 60)} min coding landed`,
    };
  }
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function base64UrlSafe(s: string): string {
  return Buffer.from(s).toString("base64");
}
