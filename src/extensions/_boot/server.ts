import { bus } from "@/core/events";
import { hooks } from "@/core/hooks";
import {
  adminSections,
  channels,
  mcpTools,
  registerAdminSection,
  registerChannel,
  registerMcpTool,
  type Plugin,
  type PluginContext,
} from "@/core/plugins/types";
import { registerPostRenderFilter } from "@/core/capabilities/post-render";
import { registerMediaProcessor } from "@/core/capabilities/media";
import { registerSitemapSource } from "@/core/capabilities/sitemap";
import { registerExtApiRoute } from "@/core/capabilities/ext-api";
import { createCronCapability } from "@/core/capabilities/scheduler";
import * as llmCapability from "@/lib/llm";
import { storage } from "@/core/capabilities/storage";
import { authorize, can, registerPolicy } from "@/core/capabilities/policies";
import { createJobsCapability, notifyAsync, notifySync } from "@/core/capabilities/jobs";
import { container } from "@/core/container-di";
import {
  registerNotificationTemplate,
  listNotificationTemplates,
} from "@/core/capabilities/notify-templates";
import { broadcast as broadcastEvent } from "@/core/capabilities/broadcast";
import { registerSearchProvider } from "@/core/capabilities/search";
import { registerGlobalMiddleware } from "@/core/capabilities/actions";
import {
  defineFlag,
  flagEnabled,
  setFlag,
  listFlagDefs,
} from "@/core/capabilities/flags";
import { registerSeed } from "@/core/capabilities/seeds";
import { gatePluginContext } from "@/core/plugins/gate";
import { isExtensionEnabled } from "@/lib/settings";

/**
 * Plugin manager. `bootPlugins()` is called once per server process
 * (from instrumentation.ts) and register()s every built-in extension.
 */

const baseCtx = {
  events: bus,
  hooks,
  registerChannel,
  registerMcpTool,
  registerAdminSection,
  registerPostRenderFilter,
  registerMediaProcessor,
  registerSitemapSource,
  registerExtApiRoute,
  cron: createCronCapability(hooks),
  llm: llmCapability,
  storage,
  policies: { register: registerPolicy, can, authorize },
};

/**
 * 版本约束匹配（极简 semver 子集）：`^1.2` = 主版本相同且 ≥1.2；
 * 纯数字 = 精确匹配。覆盖内置扩展的协商需求，不引入 semver 依赖。
 */
export function satisfiesVersion(version: string, range: string): boolean {
  const clean = range.replace(/^\^/, "");
  const [rv, rr] = [version.split(".").map(Number), clean.split(".").map(Number)];
  if (rv.length < 2 || rr.some(Number.isNaN) || rv.some(Number.isNaN)) return false;
  if (range.startsWith("^")) {
    return rv[0] === rr[0] && [rv[0], rv[1], rv[2] ?? 0].every((v, i) => {
      const lim = [rr[0], rr[1], rr[2] ?? 0][i] ?? 0;
      return i === 0 ? v === lim : v >= lim || rv[0] > Number(range[0]);
    });
  }
  return rv.every((v, i) => v >= ([rr[i] ?? 0][i] ?? 0));
}

/** 逐插件绑定命名空间（jobs/notifications 自动带扩展 id）+ 权限门控 */
function ctxFor(extensionId: string, permissions?: string[]): PluginContext {
  return gatePluginContext(
    {
    ...baseCtx,
    jobs: createJobsCapability(extensionId),
    notifications: {
      send: (userId, message) => notifySync(userId, message),
      sendAsync: (userId, message) => notifyAsync(userId, message),
      registerTemplate: (key, builder) => registerNotificationTemplate(key, builder),
      templates: () => listNotificationTemplates(),
    },
    broadcast: broadcastEvent,
    search: { registerProvider: (name, fn) => registerSearchProvider(name, fn) },
    middleware: { register: registerGlobalMiddleware },
    flags: {
      define: (key, label, def = false) => defineFlag(key, label, def),
      enabled: (key) => flagEnabled(key),
      set: (key, value) => setFlag(key, value),
      defs: () => listFlagDefs(),
    },
    seeds: { register: (name, fn) => registerSeed(`ext.${extensionId}.${name}`, fn) },
    } as PluginContext,
    permissions,
    extensionId,
  );
}

// 平台默认策略（AND 语义 —— 扩展可叠加条件，不可绕过）
registerPolicy("post.update", (user, target) => {
  const post = target as { authorId?: string };
  return Boolean(post?.authorId && post.authorId === user.id);
});
registerPolicy("post.delete", (user, target) => {
  const post = target as { authorId?: string };
  return Boolean(post?.authorId && post.authorId === user.id);
});

let booted: Promise<void> | null = null;

declare global {
   
  var __mbPluginsBooted: boolean | undefined;
}

export function bootPlugins(): Promise<void> {
  if (globalThis.__mbPluginsBooted) return Promise.resolve();
  if (!booted) {
    booted = (async () => {
      // Lazy imports keep the module graph acyclic.
      const { default: notificationsPlugin } = await import("@/extensions/notifications/server");
      const { default: webhooksPlugin } = await import("@/extensions/webhooks/server");
      const { default: moderationPlugin } = await import("@/extensions/moderation/server");
      const { default: mcpPlugin } = await import("@/extensions/mcp/server");
      const { default: exportPlugin } = await import("@/extensions/export/server");
      const { default: signaturePlugin } = await import("@/extensions/signature/server");
      const PLUGINS: Plugin[] = [
        notificationsPlugin,
        webhooksPlugin,
        moderationPlugin,
        mcpPlugin,
        exportPlugin,
        signaturePlugin,
      ];
      // B4: 依赖拓扑排序（comit.requires / plugin.requires；声明顺序为稳定次序）
      const sorted: Plugin[] = [];
      const state = new Map<string, "visiting" | "done">();
      const byName = new Map(PLUGINS.map((p) => [p.name, p]));
      const visit = (p: Plugin): void => {
        const st = state.get(p.name);
        if (st === "done") return;
        if (st === "visiting") {
          console.warn(`[plugins] circular requires around ${p.name} — falling back to declaration order`);
          sorted.push(p);
          state.set(p.name, "done");
          return;
        }
        state.set(p.name, "visiting");
        for (const r of p.requires ?? []) {
          const reqName = typeof r === "string" ? r : r.name;
          const reqRange = typeof r === "string" ? null : r.version;
          const dep = byName.get(reqName);
          if (!dep) {
            console.warn(`[plugins] ${p.name} requires "${reqName}" — 未找到，跳过该依赖`);
            continue;
          }
          if (reqRange && !satisfiesVersion(dep.version, reqRange)) {
            console.error(
              `[plugins] ${p.name} requires ${reqName}@${reqRange} 但实际为 ${dep.version} — 拒绝启动`,
            );
            continue;
          }
          visit(dep);
        }
        if (state.get(p.name) !== "done") {
          sorted.push(p);
          state.set(p.name, "done");
        }
      };
      for (const p of PLUGINS) visit(p);

      // per-extension 启用开关（setting ext.enabled；未列出 = 启用）
      const enabled: Plugin[] = [];
      const disabled: string[] = [];
      for (const p of sorted) {
        if (await isExtensionEnabled(p.name)) enabled.push(p);
        else disabled.push(p.name);
      }
      if (disabled.length) console.log(`[plugins] disabled: ${disabled.join(", ")}`);

      for (const p of enabled) {
        try {
          if (p.deferred) {
            // B3: 延迟注册 — 首次 container.resolve("ext.<id>") 时执行
            container.singleton(`ext.${p.name}`, async () => {
              await p.register(ctxFor(p.name, p.permissions));
              console.log(`[plugins] booted (deferred): ${p.name}@${p.version}`);
              return p;
            });
            console.log(`[plugins] deferred: ${p.name}@${p.version}`);
            continue;
          }
          await p.register(ctxFor(p.name, p.permissions));
          console.log(`[plugins] booted: ${p.name}@${p.version}${p.permissions ? ` (permissions: ${p.permissions.join(",")})` : " (full access)"}`);
        } catch (err) {
          console.error(`[plugins] failed to boot ${p.name}:`, err);
        }
      }
      globalThis.__mbPluginsBooted = true;
    })();
  }
  return booted;
}

export { channels, mcpTools, adminSections };
export type { Plugin, PluginContext };
