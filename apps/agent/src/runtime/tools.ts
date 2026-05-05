import type { z } from "zod";

export interface ToolContext {
  userId: string;
  eventId?: string;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  run(ctx: { input: I } & ToolContext): Promise<O>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register<I, O>(t: Tool<I, O>): void {
    if (this.tools.has(t.name)) {
      throw new Error(`tool ${t.name} already registered`);
    }
    this.tools.set(t.name, t as Tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  async dispatch(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const t = this.tools.get(name);
    if (!t) throw new Error(`tool ${name} not registered`);
    const validated = t.inputSchema.parse(input);
    return t.run({ input: validated, ...ctx });
  }
}
