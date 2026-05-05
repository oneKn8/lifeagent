import { describe, expect, it } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { type TelegramAuthPayload, verifyTelegramAuth } from "./telegram-auth";

function signPayload(
  payload: Omit<TelegramAuthPayload, "hash">,
  botToken: string,
): TelegramAuthPayload {
  const checkString = Object.entries(payload)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return { ...payload, hash };
}

describe("verifyTelegramAuth", () => {
  const TOKEN = "123:dummy-bot-token";
  const NOW = new Date(2026, 4, 4, 12, 0, 0);

  it("accepts a fresh valid payload", () => {
    const payload = signPayload(
      {
        id: 42,
        first_name: "santo",
        username: "ksanto",
        auth_date: Math.floor(NOW.getTime() / 1000),
      },
      TOKEN,
    );
    expect(verifyTelegramAuth(payload, TOKEN, { now: NOW }).ok).toBe(true);
  });

  it("rejects on hash mismatch", () => {
    const payload = signPayload(
      {
        id: 42,
        auth_date: Math.floor(NOW.getTime() / 1000),
      },
      TOKEN,
    );
    payload.hash = "deadbeef";
    const out = verifyTelegramAuth(payload, TOKEN, { now: NOW });
    expect(out.ok).toBe(false);
  });

  it("rejects when auth_date is older than maxAgeMs", () => {
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60_000);
    const payload = signPayload(
      {
        id: 42,
        auth_date: Math.floor(tenMinAgo.getTime() / 1000),
      },
      TOKEN,
    );
    const out = verifyTelegramAuth(payload, TOKEN, { now: NOW, maxAgeMs: 5 * 60_000 });
    expect(out.ok).toBe(false);
  });

  it("rejects when hash field is missing", () => {
    const out = verifyTelegramAuth(
      { id: 1, auth_date: 1 } as unknown as TelegramAuthPayload,
      TOKEN,
      { now: NOW },
    );
    expect(out.ok).toBe(false);
  });
});
