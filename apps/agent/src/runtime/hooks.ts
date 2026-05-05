import type { ToolContext } from "./tools";

export interface PreToolPayload {
  toolName: string;
  input: unknown;
  ctx: ToolContext;
}

export interface PostToolPayload {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  ctx: ToolContext;
}

export interface PreMessageSendPayload {
  channel: string;
  userId: string;
  text: string;
}

export interface PreCronFirePayload {
  jobId: string;
  kind: string;
}

export interface PostEventReplyPayload {
  eventId: string;
  userId: string;
  text: string;
}

export interface CancellableResult {
  cancel: boolean;
  reason?: string;
}

export type CancellableEventMap = {
  pre_tool: PreToolPayload;
  pre_message_send: PreMessageSendPayload;
  pre_cron_fire: PreCronFirePayload;
};

export type InformationalEventMap = {
  post_tool: PostToolPayload;
  post_event_reply: PostEventReplyPayload;
};

export type HookEventMap = CancellableEventMap & InformationalEventMap;
export type HookEventName = keyof HookEventMap;

const CANCELLABLE_EVENTS = new Set<HookEventName>([
  "pre_tool",
  "pre_message_send",
  "pre_cron_fire",
]);

type MaybePromise<T> = T | Promise<T>;

type CancellableHandler<E extends keyof CancellableEventMap> = (
  payload: CancellableEventMap[E],
) => MaybePromise<CancellableResult | undefined>;

type InformationalHandler<E extends keyof InformationalEventMap> = (
  payload: InformationalEventMap[E],
) => MaybePromise<void>;

export type HookHandler<E extends HookEventName> = E extends keyof CancellableEventMap
  ? CancellableHandler<E>
  : E extends keyof InformationalEventMap
    ? InformationalHandler<E>
    : never;

type AnyHandler = (payload: unknown) => MaybePromise<CancellableResult | undefined>;

export class HookBus {
  private handlers = new Map<HookEventName, AnyHandler[]>();

  register<E extends HookEventName>(event: E, handler: HookHandler<E>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as AnyHandler);
    this.handlers.set(event, list);
  }

  async emit<E extends keyof CancellableEventMap>(
    event: E,
    payload: CancellableEventMap[E],
  ): Promise<CancellableResult>;
  async emit<E extends keyof InformationalEventMap>(
    event: E,
    payload: InformationalEventMap[E],
  ): Promise<void>;
  async emit<E extends HookEventName>(
    event: E,
    payload: HookEventMap[E],
  ): Promise<CancellableResult | undefined> {
    const list = this.handlers.get(event) ?? [];
    if (CANCELLABLE_EVENTS.has(event)) {
      for (const h of list) {
        const out = await h(payload);
        if (out && typeof out === "object" && "cancel" in out && out.cancel === true) {
          return { cancel: true, reason: out.reason };
        }
      }
      return { cancel: false };
    }
    for (const h of list) {
      try {
        await h(payload);
      } catch (err) {
        process.stderr.write(`HookBus handler for ${event} threw: ${(err as Error).message}\n`);
      }
    }
    return undefined;
  }
}
