import { z } from "zod";
import { AppError, forbidden, unauthorized } from "@/core/errors";
import { toErrorResponse } from "@/core/errors";
import { runWithRequestContext, setRequestUser } from "@/core/logger";
import { apiUser } from "@/lib/auth/guards";
import { assertSameOrigin, ok } from "@/lib/http";
import { requestContextFromRequest } from "@/lib/http/context";
import { runRouteMiddleware } from "@/lib/http/middleware";
import { assertNotUnderMaintenance } from "@/lib/maintenance";
import { authorize } from "@/core/capabilities/policies";
import { logger } from "@/core/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Action 层（A1/A2，Laravel Controller + FormRequest 对应物）—
 * 把「解析 → 中间件 → 鉴权 → 校验 → 业务 → 响应」收敛为声明式定义：
 *
 * ```ts
 * export const toggleLike = defineAction({
 *   name: "likes.toggle", method: "POST", path: "/api/likes",
 *   auth: "user",
 *   input: z.object({ targetType: z.enum(["post", "comment"]), targetId: z.string() }),
 *   middleware: [rateLimitAction("likes", 30, 60_000)],
 *   handler: async ({ input }) => likes.toggle(input.targetType, input.targetId),
 * });
 *
 * // route.ts（3 行）：
 * export const POST = (req: Request) => runAction(req, toggleLike);
 * ```
 *
 * 全部注册的 Action 自动进入 /api/openapi.json 的文档目录（A4）。
 */

export interface ActionUser {
  id: string;
  role: string;
  username: string;
}

export interface ActionContext<TInput> {
  input: TInput;
  req: Request;
  /** auth: "user"/"admin" 时为登录用户；public 为 null */
  user: ActionUser | null;
}

export interface Middleware {
  name: string;
  /** 返回 Response 表示短路拦截；返回 void 继续 */
  handle(req: Request): Promise<Response | void> | Response | void;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ActionDef<TInput = unknown, TOutput = unknown> {
  /** 全局唯一名（`<域>.<动作>`），OpenAPI operationId / 日志标识 */
  name: string;
  method: HttpMethod;
  /** 文档化路径 */
  path: string;
  auth: "public" | "user" | "admin";
  input?: z.ZodType<TInput>;
  /** A2 FormRequest 语义：能力 + 目标提取器（authorize 不通过 → 403） */
  policy?: { ability: string; target?: (input: TInput) => unknown };
  middleware?: Middleware[];
  handler: (ctx: ActionContext<TInput>) => Promise<TOutput> | TOutput;
  /** 输出非 JSON 序列化标记（如 Response 透传） */
  raw?: boolean;
}

const g = globalThis as unknown as { __mbActions?: Map<string, ActionDef> };
const catalog: Map<string, ActionDef> = (g.__mbActions ??= new Map());
const log = logger.child({ module: "action" });

/* ---------------------------- 中间件（A3） -------------------------------- */

const gm = globalThis as unknown as { __mbGlobalMiddleware?: Middleware[] };
const globalMiddleware: Middleware[] = (gm.__mbGlobalMiddleware ??= []);

/** 扩展/平台注册的全局中间件 — 对所有 Action 生效（proxy.ts 只覆盖原始 HTTP）。 */
export function registerGlobalMiddleware(m: Middleware): void {
  globalMiddleware.push(m);
}

export function listGlobalMiddleware(): string[] {
  return globalMiddleware.map((m) => m.name);
}

/** 平台内置：内存限流中间件工厂（复用 lib/rate-limit 语义，按 ip+name 限桶）。
 *  rateLimit 契约为 async（`Promise<void>`，失败内部降级不 throw）→ await 化；
 *  Middleware 形状不变，使用方（likes.ts 等）无需改动。 */
export function rateLimitAction(name: string, limit: number, windowMs: number): Middleware {
  return {
    name: `rate-limit:${name}`,
    async handle(req) {
      await rateLimit(`${name}:${clientIp(req)}`, limit, windowMs);
    },
  };
}

/**
 * 平台内置：维护模式守卫 — 委托 lib/maintenance 的共享实现
 * assertNotUnderMaintenance（site.maintenance，lib/settings 每进程 10s TTL 缓存）。
 * 语义：仅拦截变更方法（GET/HEAD/OPTIONS 豁免），/api/auth、/api/admin、
 * /api/health 前缀路径豁免，管理员豁免，命中抛 503 maintenance。
 * 手写 route 层（lib/http 的 withApi/withUser/withAdmin、lib/permissions 的
 * withPermission）已接入同一实现。
 */
export const maintenanceGuard: Middleware = {
  name: "maintenance",
  handle(req) {
    return assertNotUnderMaintenance(req);
  },
};

/* ---------------------------- 执行器 -------------------------------------- */

function zodError(err: z.ZodError): never {
  const issue = err.issues[0];
  const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  throw new AppError(`${where}${issue?.message ?? "输入无效"}`, 422, "validation_error");
}

/** route.ts 的统一出口 — 执行完整管线并返回 Response。 */
export async function runAction<TInput, TOutput>(
  req: Request,
  def: ActionDef<TInput, TOutput>,
): Promise<Response> {
  const started = Date.now();
  // 0. Request 上下文：入口建立（requestId/ip/path/method），鉴权后 setRequestUser
  //    回填 userId —— handler 及深层（模型层/审计/事件监听器）可 requestContext() 读取
  return runWithRequestContext(requestContextFromRequest(req), async () => {
    try {
      // 1. 中间件：维护守卫（平台默认强制，见 maintenanceGuard）→ 路由级注册链
      //    （lib/http/middleware，与手写 route 守卫共享同一注册表）→ 全局 → 动作级
      const shortMaintenance = await maintenanceGuard.handle(req);
      if (shortMaintenance) return shortMaintenance;
      await runRouteMiddleware(req);
      for (const m of [...globalMiddleware, ...(def.middleware ?? [])]) {
        const short = await m.handle(req);
        if (short) return short;
      }

      // 2. 鉴权（契约约定：未认证 → 401 unauthorized；已认证但角色/权限不足 → 403 forbidden）
      let user: ActionUser | null = null;
      if (def.auth !== "public") {
        assertSameOrigin(req);
        const auth = await apiUser();
        if (!auth) throw unauthorized("请先登录 / Sign in required");
        if (def.auth === "admin" && auth.user.role !== "admin") {
          throw forbidden("需要管理员权限 / Admin required");
        }
        user = { id: auth.user.id, role: auth.user.role, username: auth.user.username };
        setRequestUser(user.id); // 回填上下文：日志与 requestContext() 可见
      }

      // 3. 输入解析（GET 用 query，其余用 JSON body）
      let input: unknown = undefined;
      if (def.input) {
        const source = def.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await req.json().catch(() => ({}));
        const parsed = def.input.safeParse(source);
        if (!parsed.success) zodError(parsed.error);
        input = parsed.data;
      }

      // 4. Policy（A2 authorize 语义）— 已认证但被 policy 拒绝仍走 403
      if (def.policy) {
        if (!user) throw unauthorized("请先登录 / Sign in required");
        const target = def.policy.target?.(input as never);
        await authorize(user as never, def.policy.ability, target);
      }

      // 5. 业务
      const result = await def.handler({ input: input as never, req, user });
      log.info("action.ok", { action: def.name, ms: Date.now() - started, userId: user?.id });
      if (def.raw) return result as unknown as Response;
      return ok(result ?? { ok: true });
    } catch (err) {
      log.warn("action.failed", {
        action: def.name,
        ms: Date.now() - started,
        err: err instanceof Error ? err : undefined,
      });
      return toErrorResponse(err);
    }
  });
}

/** defineAction — 类型收口 + 目录登记（OpenAPI/文档/盘点用）。 */
export function defineAction<TInput, TOutput>(def: ActionDef<TInput, TOutput>): ActionDef<TInput, TOutput> {
  catalog.set(def.name, def as unknown as ActionDef);
  return def;
}

export function listActions(): ActionDef[] {
  return [...catalog.values()];
}
