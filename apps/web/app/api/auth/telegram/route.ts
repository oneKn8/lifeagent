import { SESSION_COOKIE, signSession } from "@/lib/session";
import { type TelegramAuthPayload, verifyTelegramAuth } from "@/lib/telegram-auth";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as TelegramAuthPayload | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.OWNER_TELEGRAM_ID;
  if (!token || !ownerId) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  const verdict = verifyTelegramAuth(body, token);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }
  if (String(body.id) !== ownerId) {
    return NextResponse.json({ error: "not owner" }, { status: 403 });
  }
  const jwt = await signSession(String(body.id));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
