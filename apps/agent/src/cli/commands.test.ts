import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, createUser, getEventById, makeTestDb, updateEventStatus } from "@lifeagent/db";
import type { Brain, ChatChunk, ChatInput } from "../brain/types";
import { CronScheduler } from "../runtime/cron";
import { HookBus } from "../runtime/hooks";
import { MemoryStore } from "../runtime/memory";
import { LifeAgentSDK } from "../runtime/sdk";
import { SkillLoader } from "../runtime/skills";
import { ToolRegistry } from "../runtime/tools";
import type { ActivityClaim, VerificationResult, Verifier } from "../verifiers/types";
import {
  inboxCommand,
  planCommand,
  replayCommand,
  statusCommand,
  verifyNowCommand,
} from "./commands";

class NullBrain implements Brain {
  chat(_: ChatInput): AsyncIterable<ChatChunk> {
    return {
      async *[Symbol.asyncIterator]() {
        yield await Promise.resolve({ type: "stop" as const, reason: "end" });
      },
    };
  }
  async parseStructured<T>(): Promise<T> {
    throw new Error("not used");
  }
}

class StubVerifier implements Verifier {
  readonly name: string;
  constructor(
    name: string,
    private readonly result: VerificationResult,
  ) {
    this.name = name;
  }
  async authenticate(): Promise<void> {}
  async verify(_: ActivityClaim): Promise<VerificationResult> {
    return this.result;
  }
}

const FUTURE_START = new Date(Date.now() + 60 * 60_000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60_000);

describe("CLI commands", () => {
  let db: Db;
  let skillsDir: string;
  let sdk: LifeAgentSDK;
  let cron: CronScheduler;

  beforeEach(async () => {
    db = await makeTestDb();
    skillsDir = await mkdtemp(join(tmpdir(), "lifeagent-cli-"));
    await writeFile(
      join(skillsDir, "lifeagent.md"),
      "---\nname: lifeagent\ndescription: persona\ntype: persona\ntriggers: []\n---\nbody\n",
    );
    const hooks = new HookBus();
    const tools = new ToolRegistry();
    const memory = new MemoryStore(db);
    const skills = new SkillLoader({ skillsDir });
    await skills.loadAll();
    cron = new CronScheduler({ db, hooks });
    const brain = new NullBrain();
    sdk = new LifeAgentSDK({ db, brain, tools, hooks, skills, cron, memory });
  });

  afterEach(async () => {
    await sdk.stop();
    await rm(skillsDir, { recursive: true, force: true });
  });

  it("status reports today's events for the owner", async () => {
    const user = await createUser(db, { telegramId: "owner_1" });
    await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: new Date(),
      endAt: new Date(Date.now() + 60_000),
    });
    const r = await statusCommand({ db, ownerTelegramId: "owner_1" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("lift");
  });

  it("status fails when owner is not in the db", async () => {
    const r = await statusCommand({ db, ownerTelegramId: "missing" });
    expect(r.exitCode).toBe(1);
  });

  it("inbox prints empty when no event awaits a reply", async () => {
    await createUser(db, { telegramId: "owner_2" });
    const r = await inboxCommand({ db, ownerTelegramId: "owner_2" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("empty");
  });

  it("inbox surfaces a pending event", async () => {
    const user = await createUser(db, { telegramId: "owner_3" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "ship",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    await updateEventStatus(db, eventId, "planned", { postPingSentAt: new Date() });
    const r = await inboxCommand({ db, ownerTelegramId: "owner_3" });
    expect(r.stdout).toContain("ship");
  });

  it("plan creates a manual event", async () => {
    await createUser(db, { telegramId: "owner_4" });
    const r = await planCommand(
      { db, ownerTelegramId: "owner_4", sdk },
      {
        title: "lift",
        start: FUTURE_START.toISOString(),
        end: FUTURE_END.toISOString(),
      },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("created event");
  });

  it("plan rejects invalid times", async () => {
    await createUser(db, { telegramId: "owner_5" });
    const r = await planCommand(
      { db, ownerTelegramId: "owner_5", sdk },
      { title: "x", start: "not-a-date", end: "also-not" },
    );
    expect(r.exitCode).toBe(2);
  });

  it("replay re-runs cron jobs for an event", async () => {
    const user = await createUser(db, { telegramId: "owner_6" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    let firedCount = 0;
    cron.registerHandler("pre_ping", async () => {
      firedCount += 1;
    });
    cron.registerHandler("post_ping", async () => {
      firedCount += 1;
    });
    const r = await replayCommand({ db, ownerTelegramId: "owner_6", cron }, { eventId });
    expect(r.exitCode).toBe(0);
    expect(firedCount).toBe(2);
  });

  it("replay rejects unknown event id", async () => {
    await createUser(db, { telegramId: "owner_7" });
    const r = await replayCommand(
      { db, ownerTelegramId: "owner_7", cron },
      { eventId: "00000000-0000-0000-0000-000000000000" },
    );
    expect(r.exitCode).toBe(2);
  });

  it("verify-now invokes the named verifier and prints the result", async () => {
    const user = await createUser(db, { telegramId: "owner_8" });
    const { eventId } = await sdk.addManualEvent({
      userId: user.id,
      title: "lift",
      startAt: FUTURE_START,
      endAt: FUTURE_END,
    });
    const verifier = new StubVerifier("strava", {
      verifier: "strava",
      consistent: true,
      confidence: 0.9,
      summary: "1 activity overlapped",
      evidence: { activities: [{ id: 1 }] },
    });
    const r = await verifyNowCommand(
      { db, ownerTelegramId: "owner_8", verifiers: new Map([["strava", verifier]]) },
      { eventId, verifier: "strava", kind: "exercise" },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("strava");
    expect(r.stdout).toContain("consistent=true");
  });
});
