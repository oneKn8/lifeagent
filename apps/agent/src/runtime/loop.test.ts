import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { Brain, ChatChunk, ChatInput } from "../brain/types";
import { HookBus } from "./hooks";
import { AgentLoop } from "./loop";
import { ToolRegistry } from "./tools";

function chunkStream(chunks: ChatChunk[]): AsyncIterable<ChatChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

class MockBrain implements Brain {
  public calls: ChatInput[] = [];
  constructor(private readonly turns: ChatChunk[][]) {}
  chat(input: ChatInput): AsyncIterable<ChatChunk> {
    this.calls.push(input);
    const turn = this.turns[this.calls.length - 1] ?? [{ type: "stop", reason: "exhausted" }];
    return chunkStream(turn);
  }
}

describe("AgentLoop", () => {
  it("single-turn: brain returns text only, returns finalText with iterations=1", async () => {
    const brain = new MockBrain([
      [
        { type: "text", text: "hello there" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const tools = new ToolRegistry();
    const hooks = new HookBus();
    const loop = new AgentLoop({ brain, tools, hooks });
    const result = await loop.run({
      system: "you are helpful",
      userMessage: "hi",
      userId: "u1",
    });
    expect(result.finalText).toBe("hello there");
    expect(result.iterations).toBe(1);
    expect(result.stopReason).toBe("final");
    expect(result.toolCalls).toEqual([]);
  });

  it("one tool call then text: dispatches tool, brain replies on iter 2", async () => {
    const brain = new MockBrain([
      [
        { type: "tool_call", id: "c1", name: "echo", input: { msg: "hi" } },
        { type: "stop", reason: "tool" },
      ],
      [
        { type: "text", text: "got it: hi" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const tools = new ToolRegistry();
    tools.register({
      name: "echo",
      description: "echoes",
      inputSchema: z.object({ msg: z.string() }),
      run: async ({ input }) => ({ said: (input as { msg: string }).msg }),
    });
    const hooks = new HookBus();
    const loop = new AgentLoop({ brain, tools, hooks });
    const result = await loop.run({
      system: "sys",
      userMessage: "say hi",
      userId: "u1",
    });
    expect(result.iterations).toBe(2);
    expect(result.finalText).toBe("got it: hi");
    expect(result.stopReason).toBe("final");
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe("echo");
    expect(result.toolCalls[0]?.output).toEqual({ said: "hi" });
    // Second call to brain should include the tool result message
    expect(brain.calls.length).toBe(2);
    const secondMsgs = brain.calls[1]?.messages ?? [];
    expect(secondMsgs.some((m) => m.role === "tool" && m.toolCallId === "c1")).toBe(true);
  });

  it("iteration budget: brain always returns tool_call, loop stops at maxIterations", async () => {
    const turns: ChatChunk[][] = [];
    for (let i = 0; i < 20; i++) {
      turns.push([
        { type: "tool_call", id: `c${i}`, name: "noop", input: {} },
        { type: "stop", reason: "tool" },
      ]);
    }
    const brain = new MockBrain(turns);
    const tools = new ToolRegistry();
    tools.register({
      name: "noop",
      description: "no",
      inputSchema: z.object({}),
      run: async () => ({}),
    });
    const hooks = new HookBus();
    const loop = new AgentLoop({ brain, tools, hooks, maxIterations: 3 });
    const result = await loop.run({
      system: "s",
      userMessage: "u",
      userId: "u1",
    });
    expect(result.stopReason).toBe("budget");
    expect(result.iterations).toBe(3);
  });

  it("pre_tool hook cancels: tool not dispatched, loop continues", async () => {
    const brain = new MockBrain([
      [
        { type: "tool_call", id: "c1", name: "echo", input: { msg: "hi" } },
        { type: "stop", reason: "tool" },
      ],
      [
        { type: "text", text: "ok no tool" },
        { type: "stop", reason: "end" },
      ],
    ]);
    let dispatched = 0;
    const tools = new ToolRegistry();
    tools.register({
      name: "echo",
      description: "echoes",
      inputSchema: z.object({ msg: z.string() }),
      run: async () => {
        dispatched += 1;
        return { said: "x" };
      },
    });
    const hooks = new HookBus();
    hooks.register("pre_tool", async () => ({ cancel: true, reason: "blocked" }));
    const loop = new AgentLoop({ brain, tools, hooks });
    const result = await loop.run({
      system: "s",
      userMessage: "u",
      userId: "u1",
    });
    expect(dispatched).toBe(0);
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.output).toEqual({ cancelled: true, reason: "blocked" });
    expect(result.finalText).toBe("ok no tool");
    expect(result.stopReason).toBe("final");
  });

  it("tool dispatch throws: error captured, loop continues", async () => {
    const brain = new MockBrain([
      [
        { type: "tool_call", id: "c1", name: "boom", input: {} },
        { type: "stop", reason: "tool" },
      ],
      [
        { type: "text", text: "saw error" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const tools = new ToolRegistry();
    tools.register({
      name: "boom",
      description: "explodes",
      inputSchema: z.object({}),
      run: async () => {
        throw new Error("kaboom");
      },
    });
    const hooks = new HookBus();
    const loop = new AgentLoop({ brain, tools, hooks });
    const result = await loop.run({
      system: "s",
      userMessage: "u",
      userId: "u1",
    });
    expect(result.iterations).toBe(2);
    expect(result.stopReason).toBe("final");
    expect(result.toolCalls.length).toBe(1);
    const out = result.toolCalls[0]?.output as { error: string };
    expect(out.error).toContain("kaboom");
    // The tool error message should have been fed back to the brain
    const secondMsgs = brain.calls[1]?.messages ?? [];
    const toolMsg = secondMsgs.find((m) => m.role === "tool" && m.toolCallId === "c1");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain("kaboom");
  });

  it("post_tool hook fires after dispatch", async () => {
    const brain = new MockBrain([
      [
        { type: "tool_call", id: "c1", name: "echo", input: { msg: "hi" } },
        { type: "stop", reason: "tool" },
      ],
      [
        { type: "text", text: "done" },
        { type: "stop", reason: "end" },
      ],
    ]);
    const tools = new ToolRegistry();
    tools.register({
      name: "echo",
      description: "x",
      inputSchema: z.object({ msg: z.string() }),
      run: async ({ input }) => ({ said: (input as { msg: string }).msg }),
    });
    const hooks = new HookBus();
    let postCalls = 0;
    hooks.register("post_tool", async () => {
      postCalls += 1;
    });
    const loop = new AgentLoop({ brain, tools, hooks });
    await loop.run({ system: "s", userMessage: "u", userId: "u1" });
    expect(postCalls).toBe(1);
  });
});
