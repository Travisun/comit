/**
 * 结构化日志（D1）— 级别 + 上下文 + 请求关联。
 *
 *  - 输出单行 JSON 到 stdout（生产可直采；dev 可读性靠 inspect）；
 *  - `logger.child({ requestId, module })` 派生子日志器，上下文自动携带；
 *  - request-scoped 日志经 AsyncLocalStorage 传播（守卫层入口建立 Request 上下文，
 *    鉴权后回填 userId —— 深层代码经 currentRequestContext()/requestContext() 读取，
 *    消费端访问器见 lib/http/context）。
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

/**
 * Request 上下文 — 守卫层（lib/http 的 withApi/withUser/withAdmin、lib/permissions
 * 的 withPermission、actions 的 runAction）入口建立，随 ALS 在请求全程（含深层
 * await 链）传播。日志 emit 固定携带 requestId 字段（向后兼容，字段名不变）。
 */
export interface RequestContext {
  requestId?: string;
  /** 真实客户端 IP（lib/net/real-ip，部署形态感知） */
  ip?: string;
  path?: string;
  method?: string;
  /** 会话解析成功后由守卫经 setRequestUser 回填 */
  userId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

/** 以 Request 上下文运行 fn — fn 及其全部异步延续内可见（模型层/审计/事件监听器）。 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  // 浅拷贝入 store：后续 setRequestUser 的回填不会污染调用方持有的 ctx 对象
  return als.run({ ...ctx }, fn);
}

/** 兼容包装（旧签名）：等价于 runWithRequestContext({ requestId }, fn)，既有调用点零改动。 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return runWithRequestContext({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

/** 当前请求上下文（无 ALS 上下文时 undefined —— worker/SSE 延续等未走守卫的路径）。 */
export function currentRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/**
 * 回填当前请求的已认证用户 — 守卫解析出会话后调用（每请求至多一次）。
 * 无 ALS 上下文时静默跳过（不 throw，供非请求环境安全复用）。
 */
export function setRequestUser(userId: string): void {
  const store = als.getStore();
  if (store) store.userId = userId;
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
