import { forbidden, toErrorResponse, AppError, notFound } from "@/core/errors";
import { apiUser } from "@/lib/auth/guards";
import type { AuthContext } from "@/lib/auth/session";

// Convenience re-exports so route handlers can import everything from one place.
export { AppError, notFound, forbidden, toErrorResponse };
export type { AuthContext };

/**
 * Shared helpers for route handlers: CSRF-safe origin checking, JSON body
 * parsing, and a `withUser` wrapper for authenticated mutations.
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

export async function jsonBody<T>(req: Request): Promise<T> {
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
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    if (!user) throw forbidden("请先登录 / Sign in required");
    return await handler(user);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function withAdmin(
  req: Request,
  handler: (user: AuthContext) => Promise<Response>,
): Promise<Response> {
  try {
    assertSameOrigin(req);
    const user = await apiUser();
    if (!user) throw forbidden("请先登录 / Sign in required");
    if (user.user.role !== "admin") throw forbidden("需要管理员权限 / Admin required");
    return await handler(user);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function withApi(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    assertSameOrigin(req);
    return await handler();
  } catch (err) {
    return toErrorResponse(err);
  }
}

export function ok(data: unknown = { ok: true }): Response {
  return Response.json(data);
}
