/**
 * Minimal Google OAuth2 helper. Avoids the `googleapis` runtime dep so we can
 * fully test the token-exchange path against a mock fetch.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GcalCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  scopes: string[];
}

export interface OAuthExchangeOpts {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetch?: FetchLike;
}

export interface OAuthRefreshOpts {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: FetchLike;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function exchangeCodeForTokens(opts: OAuthExchangeOpts): Promise<GcalCredentials> {
  const fetchImpl = opts.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`gcal oauth exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.refresh_token) {
    throw new Error("gcal oauth exchange: no refresh_token returned (request offline access)");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope.split(/\s+/).filter(Boolean),
  };
}

export async function refreshAccessToken(opts: OAuthRefreshOpts): Promise<{
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}> {
  const fetchImpl = opts.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`gcal oauth refresh failed: ${res.status}`);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope.split(/\s+/).filter(Boolean),
  };
}

export interface GetAuthClientOpts {
  current: GcalCredentials;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  /** How many ms before expiry to consider the token stale. Default 60_000. */
  refreshSkewMs?: number;
}

/**
 * Returns valid credentials. If the access token is within `refreshSkewMs` of
 * expiring, refreshes it.
 */
export async function ensureFresh(opts: GetAuthClientOpts): Promise<GcalCredentials> {
  const skew = opts.refreshSkewMs ?? 60_000;
  if (opts.current.expiresAt - Date.now() > skew) {
    return opts.current;
  }
  const refreshed = await refreshAccessToken({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    refreshToken: opts.current.refreshToken,
    fetch: opts.fetch,
  });
  return {
    ...opts.current,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes,
  };
}

/** Build the authorization URL the user is redirected to during the consent flow. */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state?: string;
  scopes?: string[];
}): string {
  const scopes = opts.scopes ?? [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: scopes.join(" "),
  });
  if (opts.state) params.set("state", opts.state);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
