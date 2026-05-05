import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { users } from "../schema";

export interface CreateUserInput {
  telegramId?: string;
  email?: string;
  tz?: string;
}

export type User = typeof users.$inferSelect;

export async function createUser(
  db: Db,
  input: CreateUserInput,
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      telegramId: input.telegramId,
      email: input.email,
      tz: input.tz,
    })
    .returning();
  if (!row) throw new Error("createUser: insert returned no row");
  return row;
}

export async function getUserByTelegramId(
  db: Db,
  telegramId: string,
): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}
