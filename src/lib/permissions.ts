import { forbidden, unauthorized } from "@/core/errors";
import { runWithRequestContext, setRequestUser } from "@/core/logger";
import { toErrorResponse } from "@/lib/http";
import { requestContextFromRequest } from "@/lib/http/context";
import { runRouteMiddleware } from "@/lib/http/middleware";
import { assertNotUnderMaintenance } from "@/lib/maintenance";
import { apiUser } from "@/lib/auth/guards";
import type { AuthContext } from "@/lib/auth/session";

/**
 * Role-based access control. Roles: admin > editor > user.
 * Editors run the review/moderation console; admins own settings, users and ops.
 *
 * 权限解析两级（平台化能力 3）：
 *  1. 注册表优先 — registerPolicy 注册的自定义策略覆盖内置映射（后注册覆盖前注册）；
 *  2. 回落内置 — PERMISSIONS 静态角色映射是内置默认，未注册的 action 走这里；
 *  3. 双未命中（未注册且不在静态映射）→ can() 返回 false（显式注册才放行）。
 */
export type Role = "admin" | "editor" | "user";

const PERMISSIONS = {
  "admin.access": ["admin", "editor"],
  "admin.dashboard": ["admin", "editor"],
  "admin.moderate": ["admin", "editor"],
  "admin.comments": ["admin", "editor"],
  "admin.reports": ["admin", "editor"],
  "admin.verification": ["admin", "editor"],
  "admin.badges": ["admin"],
  "admin.posts": ["admin", "editor"],
  // 「彻底删除」与「通过/驳回」同级破坏性不同：审核是日常工作（editor 足够），
  // 物理删帖会连带 cascade 掉评论/点赞/投票且不可恢复，仅限 admin。
  "admin.posts.purge": ["admin"],
  "admin.settings": ["admin"],
  "admin.users": ["admin"],
  "admin.templates": ["admin"],
  "admin.media": ["admin"],
  "admin.audit": ["admin"],
  "admin.ops": ["admin"],
} as const;

// 放宽兼容：内置 key 保留字面量自动补全，`(string & {})` 允许注册自定义 action。
export type PermissionAction = keyof typeof PERMISSIONS | (string & {});

/** 策略入参：角色 + 已认证用户（can() 仅在调用方持有 AuthContext 时传 user）。 */
export interface PolicyContext {
  role: Role;
  /** 无用户实参的 can() 调用点为 undefined —— 自定义策略自行决定缺用户的结果（建议缺省拒绝）。 */
  user: AuthContext["user"] | undefined;
}

type PolicyCheck = (ctx: PolicyContext) => boolean;

// globalThis 守卫（风格同 events.ts）—— instrumentation chunk 与 route chunk、
// dev HMR 多次模块求值共享同一份注册表。
const gp = globalThis as unknown as { __mbPermissionPolicies?: Map<string, PolicyCheck> };
const policyRegistry: Map<string, PolicyCheck> = (gp.__mbPermissionPolicies ??= new Map());

const EMPTY_ROLES: readonly Role[] = [];

/**
 * 注册自定义权限策略（覆盖该 action 的内置静态映射；同名 action 后注册覆盖前注册），
 * 返回注销函数。注册过的自定义 action 才会经 can() 放行 —— 未注册且不在 PERMISSIONS
 * 的 action 恒为 false。
 *
 * 扩展接入：无需经 PluginContext —— 扩展可在自身 server 模块顶层直接调用本函数注册
 * （boot 由 instrumentation → bootPlugins 驱动，server 模块加载即生效）。
 * 与 core/capabilities/policies 的 registerPolicy（Laravel Gate 式能力+target 判定）
 * 是两层：本表管「路由/页面的角色级 action」，彼表管「对象级 ability」。
 */
export function registerPolicy(action: string, check: PolicyCheck): () => void {
  policyRegistry.set(action, check);
  return () => {
    if (policyRegistry.get(action) === check) policyRegistry.delete(action);
  };
}

/**
 * 同步鉴权：注册表有该 action 的自定义策略时以策略为准（覆盖内置），否则回落
 * PERMISSIONS 静态映射；双未命中返回 false。
 * @param user 调用方持有 AuthContext 时传入（withPermission/requirePageRole），
 *             自定义策略可基于完整用户判定；缺省 undefined。
 */
export function can(role: Role, action: PermissionAction, user?: AuthContext["user"]): boolean {
  const custom = policyRegistry.get(action);
  if (custom) return custom({ role, user });
  return ((PERMISSIONS as Record<string, readonly Role[]>)[action] ?? EMPTY_ROLES).includes(role);
}

/** Pages: redirect instead of 403. */
export async function requirePageRole(action: PermissionAction): Promise<AuthContext> {
  const { requireUser } = await import("@/lib/auth/guards");
  const auth = await requireUser();
  if (!can(auth.user.role as Role, action, auth.user)) {
    const { redirect } = await import("next/navigation");
    redirect("/admin");
  }
  return auth;
}

/** API: throws 403 when the caller's role lacks the permission. */
export async function withPermission(
  req: Request,
  action: PermissionAction,
  handler: (user: AuthContext) => Promise<Response>,
): Promise<Response> {
  // 与 lib/http 守卫同款生命周期：入口建立 Request 上下文，鉴权后回填 userId，
  // 维护检查后、handler 前执行路由中间件注册链。
  return runWithRequestContext(requestContextFromRequest(req), async () => {
    try {
      const { assertSameOrigin } = await import("@/lib/http");
      assertSameOrigin(req);
      const user = await apiUser();
      // 契约约定：未认证（无会话/会话无效）→ 401 unauthorized；
      // 已认证但角色缺少该权限 → 403 forbidden
      if (!user) throw unauthorized("请先登录 / Sign in required");
      setRequestUser(user.user.id);
      if (!can(user.user.role as Role, action, user.user)) {
        throw forbidden("没有权限 / Insufficient permissions");
      }
      // 维护模式守卫（lib/maintenance 共享实现）：isAdmin 直传复用上方会话读取，
      // 链路内不产生第二次 session 查询（/api/admin 前缀路径本身也豁免维护拦截）
      await assertNotUnderMaintenance(req, { isAdmin: user.user.role === "admin" });
      await runRouteMiddleware(req);
      return await handler(user);
    } catch (err) {
      return toErrorResponse(err);
    }
  });
}
