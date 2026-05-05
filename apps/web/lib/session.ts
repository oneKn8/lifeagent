import { SignJWT, jwtVerify } from "jose";

export interface SessionClaims {
  sub: string; // telegram id (string)
  iat: number;
  exp: number;
}

const COOKIE_NAME = "lifeagent_session";

function getSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("SESSION_SECRET or ENCRYPTION_KEY required");
  return new TextEncoder().encode(raw);
}

export async function signSession(
  telegramId: string,
  ttlSeconds = 60 * 60 * 24 * 30,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(telegramId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      iat: typeof payload.iat === "number" ? payload.iat : 0,
      exp: typeof payload.exp === "number" ? payload.exp : 0,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
