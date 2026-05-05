import { describe, expect, it } from "bun:test";
import { HookBus } from "./hooks";

describe("HookBus", () => {
  it("registers and emits a cancellable hook", async () => {
    const bus = new HookBus();
    const seen: string[] = [];
    bus.register("pre_tool", async (payload) => {
      seen.push(`saw:${payload.toolName}`);
    });
    const result = await bus.emit("pre_tool", {
      toolName: "echo",
      input: { msg: "hi" },
      ctx: { userId: "u" },
    });
    expect(result).toEqual({ cancel: false });
    expect(seen).toEqual(["saw:echo"]);
  });

  it("cancellable hooks abort the chain on first cancel", async () => {
    const bus = new HookBus();
    const calls: string[] = [];
    bus.register("pre_tool", async () => {
      calls.push("first");
      return { cancel: true, reason: "rate limit" };
    });
    bus.register("pre_tool", async () => {
      calls.push("second");
    });
    const result = await bus.emit("pre_tool", {
      toolName: "x",
      input: {},
      ctx: { userId: "u" },
    });
    expect(result).toEqual({ cancel: true, reason: "rate limit" });
    expect(calls).toEqual(["first"]);
  });

  it("informational hooks all run even if one throws", async () => {
    const bus = new HookBus();
    const calls: string[] = [];
    bus.register("post_tool", async () => {
      calls.push("a");
      throw new Error("boom");
    });
    bus.register("post_tool", async () => {
      calls.push("b");
    });
    bus.register("post_tool", async () => {
      calls.push("c");
    });
    await bus.emit("post_tool", {
      toolName: "t",
      input: {},
      output: null,
      durationMs: 1,
      ctx: { userId: "u" },
    });
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("respects registration order for cancellable hooks", async () => {
    const bus = new HookBus();
    const calls: string[] = [];
    bus.register("pre_message_send", async () => {
      calls.push("1");
    });
    bus.register("pre_message_send", async () => {
      calls.push("2");
    });
    bus.register("pre_message_send", async () => {
      calls.push("3");
    });
    await bus.emit("pre_message_send", { channel: "telegram", userId: "u", text: "hi" });
    expect(calls).toEqual(["1", "2", "3"]);
  });

  it("supports pre_cron_fire cancellable hook", async () => {
    const bus = new HookBus();
    bus.register("pre_cron_fire", async () => ({ cancel: true, reason: "paused" }));
    const result = await bus.emit("pre_cron_fire", { jobId: "j1", kind: "morning_brief" });
    expect(result).toEqual({ cancel: true, reason: "paused" });
  });

  it("supports post_event_reply informational hook", async () => {
    const bus = new HookBus();
    let captured: { eventId: string; userId: string; text: string } | null = null;
    bus.register("post_event_reply", async (payload) => {
      captured = { eventId: payload.eventId, userId: payload.userId, text: payload.text };
    });
    await bus.emit("post_event_reply", { eventId: "e1", userId: "u1", text: "ok" });
    expect(captured).toEqual({ eventId: "e1", userId: "u1", text: "ok" });
  });

  it("emit on event with no handlers resolves cleanly", async () => {
    const bus = new HookBus();
    const result = await bus.emit("pre_tool", {
      toolName: "x",
      input: {},
      ctx: { userId: "u" },
    });
    expect(result).toEqual({ cancel: false });
  });
});
