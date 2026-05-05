import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ----- Enums -----

export const eventStatus = pgEnum("event_status", [
  "planned",
  "in_progress",
  "partial",
  "done",
  "skipped",
  "slipped",
  "blocked",
]);

export const verificationStatus = pgEnum("verification_status", [
  "pending",
  "consistent",
  "contradicted",
  "inconclusive",
]);

export const cronKind = pgEnum("cron_kind", [
  "pre_ping",
  "post_ping",
  "morning_brief",
  "nightly_summary",
  "verify",
]);

// ----- Tables -----

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramId: text("telegram_id").unique(),
  email: text("email"),
  tz: text("tz").notNull().default("America/Chicago"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  externalId: text("external_id"),
  title: text("title").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  status: eventStatus("status").notNull().default("planned"),
  prePingAt: timestamp("pre_ping_at", { withTimezone: true }),
  prePingSentAt: timestamp("pre_ping_sent_at", { withTimezone: true }),
  postPingAt: timestamp("post_ping_at", { withTimezone: true }),
  postPingSentAt: timestamp("post_ping_sent_at", { withTimezone: true }),
  userReplyText: text("user_reply_text"),
  parsedState: jsonb("parsed_state"),
  verificationStatus: verificationStatus("verification_status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  channel: text("channel").notNull(),
  content: text("content").notNull(),
  attachments: jsonb("attachments"),
  relatedEventId: uuid("related_event_id").references(() => events.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryFacts = pgTable("memory_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  confidence: doublePrecision("confidence").notNull().default(1.0),
  sourceMessageId: uuid("source_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const habits = pgTable("habits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  targetFreq: text("target_freq"),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastDoneAt: timestamp("last_done_at", { withTimezone: true }),
  history: jsonb("history"),
});

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  credentialsEncrypted: text("credentials_encrypted"),
  status: text("status").notNull().default("active"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  scopes: jsonb("scopes"),
});

export const cronJobs = pgTable("cron_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scheduleExpr: text("schedule_expr").notNull(),
  kind: cronKind("kind").notNull(),
  payload: jsonb("payload"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  retryCount: integer("retry_count").notNull().default(0),
});

export const verificationRuns = pgTable("verification_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  verifier: text("verifier").notNull(),
  consistent: boolean("consistent"),
  confidence: doublePrecision("confidence"),
  summary: text("summary"),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
