import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ToolRegistry } from "./tools";

describe("ToolRegistry", () => {
  it("registers and dispatches a tool", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "echo",
      description: "echo input",
      inputSchema: z.object({ msg: z.string() }),
      async run({ input }) {
        return { echoed: input.msg };
      },
    });
    const result = await r.dispatch("echo", { msg: "hi" }, { userId: "u" });
    expect(result).toEqual({ echoed: "hi" });
  });

  it("throws on unknown tool", async () => {
    const r = new ToolRegistry();
    await expect(r.dispatch("nope", {}, { userId: "u" })).rejects.toThrow(/not registered/);
  });

  it("validates input via zod and rejects bad input", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "strict",
      description: "n",
      inputSchema: z.object({ n: z.number() }),
      async run({ input }) {
        return input.n;
      },
    });
    await expect(r.dispatch("strict", { n: "not-a-number" }, { userId: "u" })).rejects.toThrow();
  });

  it("rejects double-registration of same tool name", () => {
    const r = new ToolRegistry();
    const t = {
      name: "x",
      description: "",
      inputSchema: z.object({}),
      async run() {
        return 0;
      },
    };
    r.register(t);
    expect(() => r.register(t)).toThrow(/already registered/);
  });

  it("list() returns all registered tools", () => {
    const r = new ToolRegistry();
    r.register({
      name: "a",
      description: "",
      inputSchema: z.object({}),
      async run() {
        return 0;
      },
    });
    r.register({
      name: "b",
      description: "",
      inputSchema: z.object({}),
      async run() {
        return 0;
      },
    });
    expect(
      r
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("get() returns a registered tool by name and undefined otherwise", () => {
    const r = new ToolRegistry();
    r.register({
      name: "found",
      description: "",
      inputSchema: z.object({}),
      async run() {
        return 0;
      },
    });
    expect(r.get("found")?.name).toBe("found");
    expect(r.get("missing")).toBeUndefined();
  });

  it("passes userId and eventId through to the tool run context", async () => {
    const r = new ToolRegistry();
    let captured: { userId: string; eventId: string | undefined } | null = null;
    r.register({
      name: "ctx",
      description: "",
      inputSchema: z.object({}),
      async run({ userId, eventId }) {
        captured = { userId, eventId };
        return null;
      },
    });
    await r.dispatch("ctx", {}, { userId: "u1", eventId: "e1" });
    expect(captured).toEqual({ userId: "u1", eventId: "e1" });
  });
});
