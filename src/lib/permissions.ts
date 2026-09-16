import { forbidden, unauthorized } from "@/core/errors";
import { toErrorResponse } from "@/lib/http";
import { apiUser } from "@/lib/auth/guards";
import type { AuthContext } from "@/lib/auth/session";

/**
 * Role-based access control. Roles: admin > editor > user.
 * Editors run the review/moderation console; admins own settings, users and ops.
 */
export type Role = "admin" | "editor" | "user";

const PERMISSIONS = {
  "admin.access": ["admin", "editor"],
  "admin.dashboard": ["admin", "editor"],
  "admin.moderate": ["admin", "editor"],
  "admin.comments": ["admin", "editor"],
  "admin.reports": ["admin", "editor"],
  "admin.verification": ["admin", "editor"],
  "admin.posts": ["admin", "editor"],
  "admin.settings": ["admin"],
  "admin.users": ["admin"],
  "admin.templates": ["admin"],
  "admin.media": ["admin"],
  "admin.audit": ["admin"],
  "admin.ops": ["admin"],
} as const;

export type PermissionAction = keyof typeof PERMISSIONS;

export function can(role: Role, action: PermissionAction): boolean {
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

/** Pages: redirect instead of 403. */
export async function requirePageRole(action: PermissionAction): Promise<AuthContext> {
  const { requireUser } = await import("@/lib/auth/guards");
  const auth = await requireUser();
  if (!can(auth.user.role as Role, action)) {
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
  try {
    const { assertSameOrigin } = await import("@/lib/http");
    assertSameOrigin(req);
    const user = await apiUser();
    // 契约约定：未认证（无会话/会话无效）→ 401 unauthorized；
    // 已认证但角色缺少该权限 → 403 forbidden
    if (!user) throw unauthorized("请先登录 / Sign in required");
    if (!can(user.user.role as Role, action)) {
      throw forbidden("没有权限 / Insufficient permissions");
    }
    return await handler(user);
  } catch (err) {
    return toErrorResponse(err);
  }
}
