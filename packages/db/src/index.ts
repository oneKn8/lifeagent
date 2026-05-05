export * as schema from "./schema";
export { createDbClient, type Db } from "./client";
export { makeTestDb } from "./test-helpers";
export {
  addMemoryFact,
  topMemoryFacts,
  searchMemoryFacts,
  type MemoryFact,
  type AddMemoryFactInput,
} from "./queries/memory_facts";
export { createUser, getUserByTelegramId, type User, type CreateUserInput } from "./queries/users";
export {
  appendMessage,
  recentMessages,
  type Message,
  type AppendMessageInput,
} from "./queries/messages";
export {
  createEvent,
  getEventById,
  getEventsForDay,
  getEventsBySourceInRange,
  getLatestPendingPostPingEvent,
  updateEvent,
  updateEventStatus,
  getUpcomingEventsNeedingPings,
  type Event,
  type EventStatus,
  type CreateEventInput,
  type UpdateEventPatch,
  type UpdateEventStatusExtras,
} from "./queries/events";
export {
  recordVerificationRun,
  getVerificationsForEvent,
  type VerificationRun,
  type RecordVerificationRunInput,
} from "./queries/verification_runs";
export {
  getIntegration,
  upsertIntegration,
  type Integration,
  type UpsertIntegrationInput,
} from "./queries/integrations";
export {
  createCronJob,
  getCronJobById,
  getDueCronJobs,
  getActiveCronJobsByEventId,
  markCronJobRan,
  recordCronJobFailure,
  cancelCronJob,
  type CronJob,
  type CronJobKind,
  type CreateCronJobInput,
} from "./queries/cron_jobs";
