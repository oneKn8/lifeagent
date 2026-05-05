import type { Brain, ChatMessage, ToolDefinition } from "../brain/types";
import type { HookBus } from "./hooks";
import type { ToolRegistry } from "./tools";

export interface LoopInput {
  system: string;
  userMessage: string;
  userId: string;
  eventId?: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

export interface LoopResult {
  finalText: string;
  toolCalls: Array<{ name: string; input: unknown; output: unknown; durationMs: number }>;
  iterations: number;
  durationMs: number;
  stopReason: "final" | "budget" | "error";
}

export interface AgentLoopOptions {
  brain: Brain;
  tools: ToolRegistry;
  hooks: HookBus;
  /** Max LLM call iterations. Default 10. */
  maxIterations?: number;
  /** Wall-clock budget in ms. Default 30_000. */
  maxWallMs?: number;
  /** Number of consecutive tool exceptions before aborting. Default 3. */
  maxConsecutiveToolErrors?: number;
}

interface PendingToolCall {
  id: string;
  name: string;
  input: unknown;
}

const ERROR_STREAK_DEFAULT = 3;

export class AgentLoop {
  private readonly brain: Brain;
  private readonly tools: ToolRegistry;
  private readonly hooks: HookBus;
  private readonly maxIterations: number;
  private readonly maxWallMs: number;
  private readonly maxConsecutiveToolErrors: number;

  constructor(opts: AgentLoopOptions) {
    this.brain = opts.brain;
    this.tools = opts.tools;
    this.hooks = opts.hooks;
    this.maxIterations = opts.maxIterations ?? 10;
    this.maxWallMs = opts.maxWallMs ?? 30_000;
    this.maxConsecutiveToolErrors = opts.maxConsecutiveToolErrors ?? ERROR_STREAK_DEFAULT;
  }

  async run(input: LoopInput): Promise<LoopResult> {
    const startedAt = Date.now();
    const messages: ChatMessage[] = [{ role: "user", content: input.userMessage }];
    const toolDefs: ToolDefinition[] = this.tools.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    const allToolCalls: ToolCallRecord[] = [];
    let consecutiveErrors = 0;

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      if (Date.now() - startedAt > this.maxWallMs) {
        return this.makeResult({
          finalText: "",
          toolCalls: allToolCalls,
          iterations: iteration - 1,
          startedAt,
          stopReason: "budget",
        });
      }

      let textBuf = "";
      const pendingCalls: PendingToolCall[] = [];

      const stream = this.brain.chat({ system: input.system, messages, tools: toolDefs });
      for await (const chunk of stream) {
        if (chunk.type === "text") {
          textBuf += chunk.text;
        } else if (chunk.type === "tool_call") {
          pendingCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
        } else if (chunk.type === "stop") {
          break;
        }
      }

      if (pendingCalls.length === 0) {
        return this.makeResult({
          finalText: textBuf,
          toolCalls: allToolCalls,
          iterations: iteration,
          startedAt,
          stopReason: "final",
        });
      }

      messages.push({ role: "assistant", content: textBuf });

      let iterationHadError = false;
      for (const call of pendingCalls) {
        const ctx = { userId: input.userId, eventId: input.eventId };
        const cancellation = await this.hooks.emit("pre_tool", {
          toolName: call.name,
          input: call.input,
          ctx,
        });
        if (cancellation.cancel) {
          const output = { cancelled: true, reason: cancellation.reason };
          allToolCalls.push({
            id: call.id,
            name: call.name,
            input: call.input,
            output,
            durationMs: 0,
          });
          messages.push({
            role: "tool",
            content: JSON.stringify(output),
            toolCallId: call.id,
          });
          continue;
        }

        const t0 = Date.now();
        let output: unknown;
        try {
          output = await this.tools.dispatch(call.name, call.input, ctx);
          consecutiveErrors = 0;
        } catch (err) {
          iterationHadError = true;
          consecutiveErrors += 1;
          output = { error: (err as Error).message };
        }
        const durationMs = Date.now() - t0;

        await this.hooks.emit("post_tool", {
          toolName: call.name,
          input: call.input,
          output,
          durationMs,
          ctx,
        });

        allToolCalls.push({
          id: call.id,
          name: call.name,
          input: call.input,
          output,
          durationMs,
        });
        messages.push({
          role: "tool",
          content: JSON.stringify(output),
          toolCallId: call.id,
        });
      }

      if (iterationHadError && consecutiveErrors >= this.maxConsecutiveToolErrors) {
        return this.makeResult({
          finalText: textBuf,
          toolCalls: allToolCalls,
          iterations: iteration,
          startedAt,
          stopReason: "error",
        });
      }
    }

    return this.makeResult({
      finalText: "",
      toolCalls: allToolCalls,
      iterations: this.maxIterations,
      startedAt,
      stopReason: "budget",
    });
  }

  private makeResult(args: {
    finalText: string;
    toolCalls: ToolCallRecord[];
    iterations: number;
    startedAt: number;
    stopReason: "final" | "budget" | "error";
  }): LoopResult {
    return {
      finalText: args.finalText,
      toolCalls: args.toolCalls.map((c) => ({
        name: c.name,
        input: c.input,
        output: c.output,
        durationMs: c.durationMs,
      })),
      iterations: args.iterations,
      durationMs: Date.now() - args.startedAt,
      stopReason: args.stopReason,
    };
  }
}
