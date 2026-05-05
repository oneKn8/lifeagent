import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./session";

export async function requireOwner(): Promise<{ telegramId: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const claims = await verifySession(token);
  if (!claims) redirect("/login");
  if (process.env.OWNER_TELEGRAM_ID && claims.sub !== process.env.OWNER_TELEGRAM_ID) {
    redirect("/login");
  }
  return { telegramId: claims.sub };
}
