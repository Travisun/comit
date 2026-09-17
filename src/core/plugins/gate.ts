import type { PluginContext } from "./types";

/**
 * 插件权限门控 — capability 白名单运行时执行（app-store 模型）。
 *
 * 扩展在 manifest/Plugin 上声明 `permissions: string[]`（键 = PluginContext
 * 的顶层能力名）。声明后，ctx 中**未声明的能力**被替换为「拒绝存根」：
 * 任何属性访问/方法调用即抛错并携带扩展 id，便于排障与审计。
 *
 * 威胁模型说明：这是**能力声明边界**（防误用、显式化信任面），不是进程级
 * 沙箱 —— 直接 `import { db }` 的扩展代码不受此门控约束（那需要进程隔离）。
 * 门控的价值：
 *  1. 让扩展的权限面成为显式声明 + 可审计的契约（manifest → boot 日志）；
 *  2. 为未来的进程隔离/权限令牌体系预留运行时执行点；
 *  3. 未声明 → 全量信任（内置扩展零改动向后兼容）。
 */

/** PluginContext 的全部能力键（与 types.ts 一致；新增能力须同步）。 */
export const PLUGIN_CAPABILITY_KEYS = [
  "events",
  "hooks",
  "registerChannel",
  "registerMcpTool",
  "registerPostRenderFilter",
  "registerMediaProcessor",
  "registerSitemapSource",
  "registerExtApiRoute",
  "cron",
  "llm",
  "storage",
  "policies",
  "jobs",
  "notifications",
  "broadcast",
  "search",
  "middleware",
  "flags",
  "seeds",
] as const;

export type PluginCapabilityKey = (typeof PLUGIN_CAPABILITY_KEYS)[number];

/**
 * 权限门控：返回按 permissions 白名单裁剪后的 ctx。
 *  - permissions 为 null/undefined → 全量信任（内置扩展向后兼容）；
 *  - 声明后，未列入的能力替换为拒绝存根（Proxy，访问即抛 + console.error）。
 */
export function gatePluginContext(
  ctx: PluginContext,
  permissions: string[] | null | undefined,
  extensionId: string,
): PluginContext {
  if (!permissions || permissions.length === 0) return ctx;
  const allowed = new Set(permissions);
  const gated = {} as Record<string, unknown>;
  for (const key of PLUGIN_CAPABILITY_KEYS) {
    if (allowed.has(key)) {
      gated[key] = (ctx as unknown as Record<string, unknown>)[key];
    } else {
      gated[key] = new Proxy({ __denied: key }, {
        get(_t, prop) {
          throw new Error(
            `[plugins] ${extensionId} 未声明能力 "${key}"（属性 ${String(prop)}）— ` +
            `请在 permissions 中声明后使用`,
          );
        },
      });
    }
  }
  return gated as unknown as PluginContext;
}
