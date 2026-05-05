import { beforeEach, describe, expect, it } from "bun:test";
import {
  type Db,
  createEvent,
  createUser,
  getEventById,
  getVerificationsForEvent,
  makeTestDb,
} from "@lifeagent/db";
import { TelegramAdapter } from "../../adapters/telegram";
import type { Brain, ChatChunk, ChatInput } from "../../brain/types";
import type {
  ActivityClaim,
  ActivityKind,
  VerificationResult,
  Verifier,
} from "../../verifiers/types";
import { HookBus } from "../hooks";
import { AgentLoop } from "../loop";
import { ToolRegistry } from "../tools";
import { createSendMessageTool } from "../tools/send_message";
import { createConfrontStep, defaultInferKind } from "./confront";

class StubVerifier implements Verifier {
  readonly name: string;
  public lastClaim: ActivityClaim | null = null;
  constructor(
    name: string,
    private readonly result: VerificationResult,
  ) {
    this.name = name;
  }
  async authenticate(): Promise<void> {}
  async verify(claim: ActivityClaim): Promise<VerificationResult> {
    this.lastClaim = claim;
    return this.result;
  }
}

class ScriptedBrain implements Brain {
  public lastSystem: string | null = null;
  constructor(private readonly turns: ChatChunk[][]) {}
  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    this.lastSystem = input.system;
    const chunks = this.turns.shift() ?? [{ type: "stop" as const, reason: "end" }];
    return {
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
      },
    };
  }
  async parseStructured<T>(): Promise<T> {
    throw new Error("not used");
  }
}

function makeFakeApi() {
  const sent: Array<{ chatId: number | string; text: string }> = [];
  return {
    sent,
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
    },
  };
}

describe("defaultInferKind", () => {
  it("infers exercise from a 'lift' title", () => {
    const ev = {
      title: "lift",
      notes: null,
    } as unknown as Parameters<typeof defaultInferKind>[0];
    expect(defaultInferKind(ev)).toBe("exercise");
  });
  it("infers code from a 'ship the PR' title", () => {
    const ev = {
      title: "ship the PR",
      notes: null,
    } as unknown as Parameters<typeof defaultInferKind>[0];
    expect(defaultInferKind(ev)).toBe("code");
  });
  it("returns null for unrelated titles", () => {
    const ev = {
      title: "lunch with parents",
      notes: null,
    } as unknown as Parameters<typeof defaultInferKind>[0];
    expect(defaultInferKind(ev)).toBeNull();
  });
});

describe("confront step", () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("records verification_runs row and confronts when verifier inconsistent + confidence > threshold", async () => {
    const user = await createUser(db, { telegramId: "tg_conf_1" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "lift",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const verifier = new StubVerifier("strava", {
      verifier: "strava",
      consistent: false,
      confidence: 0.9,
      summary: "no strava activity in window",
      evidence: { activities: [] },
    });
    const verifiers = new Map<ActivityKind, Verifier>([["exercise", verifier]]);

    const api = makeFakeApi();
    const adapter = new TelegramAdapter({
      token: "t",
      ownerId: 1,
      onMessage: () => {},
      api,
    });
    const tools = new ToolRegistry();
    tools.register(createSendMessageTool({ adapter, db }));
    const hooks = new HookBus();
    const brain = new ScriptedBrain([
      [
        {
          type: "tool_call",
          id: "c1",
          name: "send_message",
          input: {
            text: "you said done but strava is empty for that window. what actually happened?",
          },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text", text: "" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const loop = new AgentLoop({ brain, tools, hooks });

    const confront = createConfrontStep({ db, verifiers, loop });
    const out = await confront({ event, reportedStatus: "done" });

    expect(out.verifierRan).toBe(true);
    expect(out.consistent).toBe(false);
    expect(out.confronted).toBe(true);
    expect(out.verificationRunId).toBeDefined();

    const runs = await getVerificationsForEvent(db, event.id);
    expect(runs).toHaveLength(1);

    expect(api.sent).toHaveLength(1);
    expect(brain.lastSystem ?? "").toContain(out.verificationRunId ?? "");

    const after = await getEventById(db, event.id);
    expect(after?.verificationStatus).toBe("contradicted");
  });

  it("does not confront when verifier is consistent", async () => {
    const user = await createUser(db, { telegramId: "tg_conf_2" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "lift",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const verifier = new StubVerifier("strava", {
      verifier: "strava",
      consistent: true,
      confidence: 0.95,
      summary: "1 activity overlapped",
      evidence: { activities: [{ id: 1 }] },
    });
    const api = makeFakeApi();
    const adapter = new TelegramAdapter({
      token: "t",
      ownerId: 1,
      onMessage: () => {},
      api,
    });
    const tools = new ToolRegistry();
    tools.register(createSendMessageTool({ adapter, db }));
    const hooks = new HookBus();
    const brain = new ScriptedBrain([]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const confront = createConfrontStep({
      db,
      verifiers: new Map([["exercise", verifier]]),
      loop,
    });
    const out = await confront({ event, reportedStatus: "done" });
    expect(out.confronted).toBe(false);
    expect(out.consistent).toBe(true);
    expect(api.sent).toHaveLength(0);

    const after = await getEventById(db, event.id);
    expect(after?.verificationStatus).toBe("consistent");
  });

  it("marks inconclusive when confidence is below threshold and skips confront", async () => {
    const user = await createUser(db, { telegramId: "tg_conf_3" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "code",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const verifier = new StubVerifier("github", {
      verifier: "github",
      consistent: false,
      confidence: 0.3,
      summary: "api error; treating as inconclusive",
      evidence: { status: 500 },
    });
    const tools = new ToolRegistry();
    const hooks = new HookBus();
    const brain = new ScriptedBrain([]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const confront = createConfrontStep({
      db,
      verifiers: new Map([["code", verifier]]),
      loop,
    });
    const out = await confront({ event, reportedStatus: "done" });
    expect(out.confronted).toBe(false);
    const after = await getEventById(db, event.id);
    expect(after?.verificationStatus).toBe("inconclusive");
  });

  it("skips confrontation when no verifier is mapped to the inferred kind", async () => {
    const user = await createUser(db, { telegramId: "tg_conf_4" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "lunch with parents",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const tools = new ToolRegistry();
    const hooks = new HookBus();
    const brain = new ScriptedBrain([]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const confront = createConfrontStep({
      db,
      verifiers: new Map(),
      loop,
    });
    const out = await confront({ event, reportedStatus: "done" });
    expect(out.verifierRan).toBe(false);
    expect(out.confronted).toBe(false);
  });

  it("does not crash when reportedStatus is 'slipped'", async () => {
    const user = await createUser(db, { telegramId: "tg_conf_5" });
    const event = await createEvent(db, {
      userId: user.id,
      source: "manual",
      title: "lift",
      startAt: new Date("2026-05-04T15:00:00Z"),
      endAt: new Date("2026-05-04T16:00:00Z"),
    });
    const verifier = new StubVerifier("strava", {
      verifier: "strava",
      consistent: true,
      confidence: 0.95,
      summary: "ok",
      evidence: null,
    });
    const tools = new ToolRegistry();
    const hooks = new HookBus();
    const brain = new ScriptedBrain([]);
    const loop = new AgentLoop({ brain, tools, hooks });
    const confront = createConfrontStep({
      db,
      verifiers: new Map([["exercise", verifier]]),
      loop,
    });
    const out = await confront({ event, reportedStatus: "slipped" });
    expect(out.verifierRan).toBe(false);
    expect(out.confronted).toBe(false);
  });
});
