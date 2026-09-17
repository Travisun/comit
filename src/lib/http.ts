import { forbidden, toErrorResponse, AppError, notFound, unauthorized } from "@/core/errors";
import { runWithRequestContext, setRequestUser } from "@/core/logger";
import { apiUser } from "@/lib/auth/guards";
import type { AuthContext } from "@/lib/auth/session";
import { requestContextFromRequest, requestContext } from "@/lib/http/context";
import { runRouteMiddleware } from "@/lib/http/middleware";
import { assertNotUnderMaintenance } from "@/lib/maintenance";
import { callHook } from "@/core/hooks";

// Convenience re-exports so route handlers can import everything from one place.
export { AppError, notFound, forbidden, unauthorized, toErrorResponse };
export type { AuthContext };
// Request 上下文消费端 —— 深层代码（模型层/审计/事件监听器）从守卫内任意深度：
// `requestContext()` 拿标准化请求信息（无上下文返回 null，见 lib/http/context）。
export { requestContext };
export type { RequestContext } from "@/core/logger";

/**
 * Shared helpers for route handlers: CSRF-safe origin checking, JSON body
 * parsing, and a `withUser` wrapper for authenticated mutations.
 *
 * 守卫统一生命周期（平台化能力 1/2）：入口 runWithRequestContext 建立上下文
 * （requestId/ip/path/method）→ 鉴权成功 setRequestUser 回填 userId → 维护检查 →
 * 执行路由中间件注册链（lib/http/middleware，任一抛错短路）→ handler。
 * handler 及其深层 await 链内可随时 requestContext() 读取。
 */

export function assertSameOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client (curl, MCP) — token auth applies
  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw forbidden("跨站请求被拒绝 / Cross-origin request blocked");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw forbidden("非法来源 / Bad origin");
  }
}

/** JSON body 大小预检上限：route handler 无框架级 body 限制，先按
 * content-length 短路再解析，避免超大 body 全额进内存后才被 zod 拒绝。
 * 站内 JSON 载荷（评论 ≤2000 字、设置项等）远低于 1MB。 */
const JSON_BODY_MAX_BYTES = 1024 * 1024;

export async function jsonBody<T>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > JSON_BODY_MAX_BYTES) {
    throw new AppError("请求体过大 / Payload too large", 413, "payload_too_large");
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError("请求体不是合法 JSON / Invalid JSON body", 400, "bad_json");
  }
}

export async function withUser(
  req: Request,
  handler: (user: AuthContext) => Promise<Response>,
): Promise<Response> {
  return runWithRequestContext(requestContextFromRequest(req), async () => {
    try {
      assertSameOrigin(req);
      void callHook("request:api", { method: req.method, path: new URL(req.url).pathname, ip: "" });
      const user = await apiUser();
      // 契约约定：无会话/会话无效 → 401 unauthorized；已登录但无权限 → 403 forbidden
      if (!user) throw unauthorized("请先登录 / Sign in required");
      setRequestUser(user.user.id); // 回填上下文：日志与 requestContext() 可见
      // 维护模式守卫（lib/maintenance 共享实现）：isAdmin 直传复用上方那次会话
      // 读取，链路内不产生第二次 session 查询（维护关闭时零额外成本）
      await assertNotUnderMaintenance(req, { isAdmin: user.user.role === "admin" });
      await runRouteMiddleware(req); // 路由级注册链：鉴权与维护之后、handler 之前
      return await handler(user);
    } catch (err) {
      return toErrorResponse(err);
    }
  });
}

export async function withAdmin(
  req: Request,
  handler: (user: AuthContext) => Promise<Response>,
): Promise<Response> {
  return runWithRequestContext(requestContextFromRequest(req), async () => {
    try {
      assertSameOrigin(req);
      const user = await apiUser();
      // 契约约定：未认证 → 401；已认证但角色不足 → 403
      if (!user) throw unauthorized("请先登录 / Sign in required");
      if (user.user.role !== "admin") throw forbidden("需要管理员权限 / Admin required");
      setRequestUser(user.user.id);
      // 维护模式守卫：管理员恒豁免，直接传 isAdmin 省去内部会话读取
      await assertNotUnderMaintenance(req, { isAdmin: true });
      await runRouteMiddleware(req);
      return await handler(user);
    } catch (err) {
      return toErrorResponse(err);
    }
  });
}

export async function withApi(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  return runWithRequestContext(requestContextFromRequest(req), async () => {
    try {
      assertSameOrigin(req);
      // 维护模式守卫：本包装无既有鉴权，命中维护时才在内部读一次会话做管理员豁免
      // （site.maintenance 有 10s 进程缓存，维护关闭时这里的成本近乎为零）
      await assertNotUnderMaintenance(req);
      await runRouteMiddleware(req); // 无鉴权段：维护检查后即执行注册链
      return await handler();
    } catch (err) {
      return toErrorResponse(err);
    }
  });
}

/* ---------------------------- 响应助手 ------------------------------------ */

export function ok(data: unknown = { ok: true }): Response {
  return Response.json(data);
}

/** 201 Created — 资源创建成功（POST 落库类路由/Action 的语义化出口）。 */
export function created(data: unknown): Response {
  return Response.json(data, { status: 201 });
}

/** 204 No Content — 无响应体（删除/登出等空响应语义）。 */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** 薄封装 Response.json — 需要自定义 status/headers 时用（ok/created 的通用逃生口）。 */
export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}
