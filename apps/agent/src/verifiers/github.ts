import type { ActivityClaim, VerificationResult, Verifier } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GithubVerifierOptions {
  /** Returns the user's PAT. */
  getToken: (userId: string) => Promise<string>;
  fetch?: FetchLike;
  baseUrl?: string;
}

interface ContributionsResponse {
  data: {
    viewer: {
      contributionsCollection: {
        commitContributionsByRepository: Array<{
          repository: { nameWithOwner: string };
          contributions: { totalCount: number };
        }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export class GithubVerifier implements Verifier {
  readonly name = "github";
  private readonly getToken: GithubVerifierOptions["getToken"];
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(opts: GithubVerifierOptions) {
    this.getToken = opts.getToken;
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.github.com";
  }

  async authenticate(userId: string): Promise<void> {
    await this.getToken(userId);
  }

  async verify(claim: ActivityClaim): Promise<VerificationResult> {
    if (claim.kind !== "code") {
      return {
        verifier: this.name,
        evidence: null,
        consistent: true,
        confidence: 0,
        summary: `github does not verify kind=${claim.kind}; inconclusive`,
      };
    }

    const token = await this.getToken(claim.userId);
    const query = `query($from: DateTime!, $to: DateTime!) {
      viewer {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 25) {
            repository { nameWithOwner }
            contributions(first: 1) { totalCount }
          }
        }
      }
    }`;
    const variables = {
      from: claim.windowStart.toISOString(),
      to: claim.windowEnd.toISOString(),
    };
    const res = await this.fetchImpl(`${this.baseUrl}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      return {
        verifier: this.name,
        evidence: { status: res.status },
        consistent: claim.reportedStatus !== "done",
        confidence: 0.1,
        summary: `github api error ${res.status}; inconclusive`,
      };
    }
    const body = (await res.json()) as ContributionsResponse;
    if (body.errors && body.errors.length > 0) {
      return {
        verifier: this.name,
        evidence: body.errors,
        consistent: claim.reportedStatus !== "done",
        confidence: 0.1,
        summary: "github graphql error; inconclusive",
      };
    }
    const totalCommits =
      body.data.viewer.contributionsCollection.commitContributionsByRepository.reduce(
        (sum, r) => sum + r.contributions.totalCount,
        0,
      );

    if (claim.reportedStatus === "done" || claim.reportedStatus === "partial") {
      const consistent = totalCommits > 0;
      return {
        verifier: this.name,
        evidence: {
          totalCommits,
          repos: body.data.viewer.contributionsCollection.commitContributionsByRepository,
        },
        consistent,
        confidence: consistent ? 0.9 : 0.85,
        summary: consistent ? `${totalCommits} commit(s) in window` : "no commits found in window",
      };
    }

    const consistent = totalCommits === 0;
    return {
      verifier: this.name,
      evidence: { totalCommits },
      consistent,
      confidence: consistent ? 0.9 : 0.85,
      summary: consistent
        ? "user reported skipped and no commits were found"
        : `user reported skipped but ${totalCommits} commit(s) landed`,
    };
  }
}
