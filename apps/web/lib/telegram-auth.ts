import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram Login Widget payload validation per
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  [k: string]: unknown;
}

const FIVE_MIN_MS = 5 * 60_000;

export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
  opts: { now?: Date; maxAgeMs?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!payload.hash) return { ok: false, reason: "missing hash" };

  const now = opts.now ?? new Date();
  const maxAgeMs = opts.maxAgeMs ?? FIVE_MIN_MS;
  if (Math.abs(now.getTime() - payload.auth_date * 1000) > maxAgeMs) {
    return { ok: false, reason: "auth_date too old" };
  }

  const checkString = Object.entries(payload)
    .filter(([k, v]) => k !== "hash" && v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(payload.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "hash mismatch" };
  }
  return { ok: true };
}
