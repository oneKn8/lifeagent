import type { SourceAdapter } from "../../adapters/source";
import type { CronHandler } from "../cron";

export interface GcalSyncDeps {
  adapter: SourceAdapter;
  /** Window before now to sync. Default 6 hours. */
  pastWindowMs?: number;
  /** Window after now to sync. Default 7 days. */
  futureWindowMs?: number;
}

export function createGcalSyncHandler(deps: GcalSyncDeps): CronHandler {
  const past = deps.pastWindowMs ?? 6 * 60 * 60_000;
  const future = deps.futureWindowMs ?? 7 * 24 * 60 * 60_000;
  return async (job) => {
    const now = new Date();
    const range = {
      start: new Date(now.getTime() - past),
      end: new Date(now.getTime() + future),
    };
    await deps.adapter.syncEvents(job.userId, range);
  };
}
