import { describe, expect, it } from "bun:test";
import { buildAuthUrl, ensureFresh, exchangeCodeForTokens, refreshAccessToken } from "./oauth";

function makeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchFn, calls };
}

describe("gcal oauth", () => {
  it("buildAuthUrl includes offline access and consent prompt", () => {
    const url = buildAuthUrl({
      clientId: "abc",
      redirectUri: "https://example.com/cb",
      state: "csrf",
    });
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=csrf");
    expect(url).toContain("client_id=abc");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcb");
  });

  it("exchangeCodeForTokens returns credentials including refresh token", async () => {
    const { fetch: f, calls } = makeFetch({
      access_token: "AT",
      refresh_token: "RT",
      expires_in: 3600,
      token_type: "Bearer",
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    });
    const creds = await exchangeCodeForTokens({
      clientId: "id",
      clientSecret: "sec",
      redirectUri: "rurl",
      code: "the-code",
      fetch: f,
    });
    expect(creds.accessToken).toBe("AT");
    expect(creds.refreshToken).toBe("RT");
    expect(creds.scopes.length).toBeGreaterThan(0);
    expect(calls[0]?.body).toContain("code=the-code");
  });

  it("exchangeCodeForTokens throws when refresh_token is missing", async () => {
    const { fetch: f } = makeFetch({
      access_token: "AT",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "scope",
    });
    await expect(
      exchangeCodeForTokens({
        clientId: "id",
        clientSecret: "sec",
        redirectUri: "rurl",
        code: "c",
        fetch: f,
      }),
    ).rejects.toThrow(/no refresh_token/);
  });

  it("refreshAccessToken returns the new access token", async () => {
    const { fetch: f } = makeFetch({
      access_token: "newAT",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "scope",
    });
    const out = await refreshAccessToken({
      clientId: "id",
      clientSecret: "sec",
      refreshToken: "RT",
      fetch: f,
    });
    expect(out.accessToken).toBe("newAT");
  });

  it("ensureFresh reuses unexpired token", async () => {
    let called = 0;
    const f = async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    };
    const out = await ensureFresh({
      current: {
        accessToken: "AT",
        refreshToken: "RT",
        expiresAt: Date.now() + 5 * 60_000,
        scopes: ["x"],
      },
      clientId: "id",
      clientSecret: "sec",
      fetch: f,
    });
    expect(out.accessToken).toBe("AT");
    expect(called).toBe(0);
  });

  it("ensureFresh refreshes a near-expired token", async () => {
    const { fetch: f } = makeFetch({
      access_token: "newAT",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "x",
    });
    const out = await ensureFresh({
      current: {
        accessToken: "old",
        refreshToken: "RT",
        expiresAt: Date.now() + 1000, // ~1s from now
        scopes: ["x"],
      },
      clientId: "id",
      clientSecret: "sec",
      fetch: f,
    });
    expect(out.accessToken).toBe("newAT");
  });
});
