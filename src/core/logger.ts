/**
 * 结构化日志（D1）— 级别 + 上下文 + 请求关联。
 *
 *  - 输出单行 JSON 到 stdout（生产可直采；dev 可读性靠 inspect）；
 *  - `logger.child({ requestId, module })` 派生子日志器，上下文自动携带；
 *  - request-scoped 日志经 AsyncLocalStorage 传播（http 层注入 requestId）。
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

const als = new AsyncLocalStorage<{ requestId?: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return als.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(bound: Record<string, unknown>): Logger;
}

function emit(level: Level, base: Record<string, unknown>, msg: string, ctx?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    requestId: currentRequestId(),
    ...base,
    ...(ctx ?? {}),
  };
  const line = JSON.stringify(record, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug: (msg, ctx) => emit("debug", base, msg, ctx),
    info: (msg, ctx) => emit("info", base, msg, ctx),
    warn: (msg, ctx) => emit("warn", base, msg, ctx),
    error: (msg, ctx) => emit("error", base, msg, ctx),
    child: (bound) => createLogger({ ...base, ...bound }),
  };
}

export const logger = createLogger({ app: "comit" });
