/**
 * 路由中间件注册表（平台化能力 2）— 手写 route 守卫与 Action 管线共享的
 * 「路由级」拦截链（对照 maintenance.ts 之外的第二个内置注册用例）。
 *
 * 执行点（注册链在「鉴权与维护检查之后、业务 handler 之前」运行）：
 *  - lib/http 的 withApi / withUser / withAdmin（withApi 无鉴权：维护检查后即执行）；
 *  - lib/permissions 的 withPermission（维护检查后、handler 前）；
 *  - actions 的 runAction（maintenanceGuard 之后、动作级中间件之前）。
 *
 * 语义：
 *  - 按注册顺序执行；任一中间件抛错（AppError）即中断整条链，错误沿守卫的
 *    try/catch 由 toErrorResponse 统一转响应（如 403/429）；
 *  - 去重：同名（name）只注册一次，后注册覆盖前注册（原地替换，注册时序不变）；
 *  - 注册表挂在 globalThis（风格同 events.ts / actions.ts）—— instrumentation
 *    chunk 与 route chunk、dev HMR 多次求值共享同一份，注册不丢失。
 *
 * 扩展接入：无需经 PluginContext —— 扩展可在自身 server 模块顶层直接调用
 * registerRouteMiddleware（模块被 import 时即注册生效；扩展 boot 由
 * instrumentation → bootPlugins 驱动，server 模块在注册阶段就会被加载）。
 */
import { forbidden } from "@/core/errors";

export interface RouteMiddleware {
  name: string;
  /** 抛错（AppError）= 短路拦截；正常返回 = 放行。与 actions.Middleware 的返回 Response 短路不同。 */
  handle: (req: Request) => void | Promise<void>;
}

const g = globalThis as unknown as { __mbRouteMiddleware?: RouteMiddleware[] };
const registry: RouteMiddleware[] = (g.__mbRouteMiddleware ??= []);

/**
 * 注册路由中间件，返回注销函数（测试/动态扩展用）。
 * 同名去重：后注册覆盖前注册，且保持首个注册的执行位次。
 */
export function registerRouteMiddleware(mw: RouteMiddleware): () => void {
  const idx = registry.findIndex((m) => m.name === mw.name);
  if (idx >= 0) registry[idx] = mw;
  else registry.push(mw);
  return () => {
    const i = registry.findIndex((m) => m.name === mw.name);
    if (i >= 0 && registry[i] === mw) registry.splice(i, 1);
  };
}

/** 已注册的路由中间件名（诊断/盘点用，按执行顺序）。 */
export function listRouteMiddleware(): string[] {
  return registry.map((m) => m.name);
}

/** 执行注册链：按注册顺序 await；任一抛错即中断并向上抛（由守卫层统一转响应）。 */
export async function runRouteMiddleware(req: Request): Promise<void> {
  for (const mw of registry) {
    await mw.handle(req);
  }
}

/* ------------------------ 内置示例：blockedPaths ------------------------- */

/**
 * 内置示范中间件：读 MB_BLOCKED_PATHS（逗号分隔路径列表）屏蔽请求，命中即 403。
 * 匹配语义：条目精确命中，或作为前缀屏蔽整棵子树（"/api/internal" 同时拦
 * "/api/internal" 与 "/api/internal/x"）。对所有方法生效（含 GET）。
 *
 * 兼作注册表用法的文档性示范 —— 扩展按同样三行即可注册自己的中间件：
 * `registerRouteMiddleware({ name: "my-mw", handle(req) { ... } })`。
 * 无 MB_BLOCKED_PATHS 时零成本（一次 process.env 读取）直接放行。
 */
function blockedPaths(): RouteMiddleware {
  return {
    name: "blocked-paths",
    handle(req) {
      const raw = process.env.MB_BLOCKED_PATHS;
      if (!raw) return;
      const blocked = raw.split(",").map((p) => p.trim()).filter(Boolean);
      if (blocked.length === 0) return;
      const path = new URL(req.url).pathname;
      // 双重形态匹配（raw + 解码）：URL.pathname 保留 %XX，而 Next 的路由分发
      // 按**解码后**的路径命中 handler —— 只比 raw 时 `/api/%69nternal` 能绕过
      // 屏蔽却照样进到被屏蔽的接口。非法 % 序列无法判定真实路径 ⇒ 拒绝（fail closed）
      const candidates = [path];
      if (path.includes("%")) {
        try {
          const decoded = decodeURIComponent(path);
          if (decoded !== path) candidates.push(decoded);
        } catch {
          throw forbidden("非法路径编码 / Invalid path encoding");
        }
      }
      // 条目归一化去尾斜杠："/api/internal/" 与 "/api/internal" 同义，
      // 均拦裸路径与整棵子树
      const hit = blocked.some((p) => {
        const norm = p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
        return candidates.some((c) => c === norm || c.startsWith(`${norm}/`));
      });
      if (hit) throw forbidden("路径已被屏蔽 / Path blocked");
    },
  };
}

// 代码就位即生效：本模块被任一守卫/Action 管线加载时自动注册。
registerRouteMiddleware(blockedPaths());
