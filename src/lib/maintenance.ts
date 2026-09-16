import { AppError } from "@/core/errors";
import { apiUser } from "@/lib/auth/guards";

/**
 * 维护模式守卫（共享实现）— Action 层（core/capabilities/actions 的
 * maintenanceGuard）与手写 route 层（lib/http 的 withApi/withUser/withAdmin、
 * lib/permissions 的 withPermission）统一委托到这里。
 *
 * 语义：仅拦截「变更方法」（GET/HEAD/OPTIONS 豁免，站点只读可用）；
 * /api/auth、/api/admin、/api/health 前缀路径豁免；管理员豁免；
 * 命中抛 503 AppError code="maintenance"（由 toErrorResponse 统一转 envelope）。
 *
 * 依赖方向（防循环导入）：本模块只允许 import core/errors、lib/auth 轻量会话
 * 读取（apiUser）、lib/settings（动态 import）。禁止 import lib/http —— 反向
 * 依赖（http → maintenance → settings/auth）保持单向。
 *
 * 成本：site.maintenance 走 lib/settings 每进程 10s TTL 缓存（零查询）；
 * 管理员豁免的会话读取只在「维护开启 + 变更方法 + 非豁免路径」时发生，且
 * getAuth 按 React cache 每请求记忆化 —— http 层已鉴权的调用方直接传
 * opts.isAdmin，链路内不产生第二次会话查询。
 */

/** 维护模式下永不拦截的前缀（认证 / 管理 / 健康检查）。 */
const EXEMPT_PATH_PREFIXES = ["/api/auth", "/api/admin", "/api/health"];

export function isMaintenanceExemptPath(pathname: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/** 只读方法豁免：维护期间站点保持可浏览。 */
export function isReadOnlyMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

/**
 * 维护模式守卫：命中条件（维护开启 + 变更方法 + 非豁免路径 + 非管理员）时抛
 * 503 AppError("maintenance")，否则静默放行。
 *
 * @param opts.isAdmin 调用链上游已完成鉴权并确认管理员时传 true，
 *   跳过内部的会话读取（withAdmin / 已知 admin 的 withUser / withPermission）。
 */
export async function assertNotUnderMaintenance(
  req: Request,
  opts: { isAdmin?: boolean } = {},
): Promise<void> {
  if (isReadOnlyMethod(req.method)) return;
  if (isMaintenanceExemptPath(new URL(req.url).pathname)) return;
  // 动态 import：与 actions.ts 原实现一致，避免把 db/settings 拖进不需要它的导入链
  const { getSetting } = await import("@/lib/settings");
  if (!(await getSetting("site.maintenance"))) return;
  if (opts.isAdmin) return;
  const auth = await apiUser();
  if (auth?.user.role === "admin") return;
  throw new AppError("站点维护中，请稍后再来 / Site is under maintenance", 503, "maintenance");
}
