import { bus } from "@/core/events";
import { hooks } from "@/core/hooks";
import {
  adminSections,
  channels,
  mcpTools,
  widgets,
  registerAdminSection,
  registerChannel,
  registerMcpTool,
  registerWidget,
  type Plugin,
  type PluginContext,
} from "./types";

/**
 * Plugin manager. `bootPlugins()` is called once per server process
 * (from instrumentation.ts) and register()s every built-in plugin.
 * Third-party plugins can be appended to PLUGINS the same way.
 */

const ctx: PluginContext = {
  events: bus,
  hooks,
  registerChannel,
  registerMcpTool,
  registerWidget,
  registerAdminSection,
};

let booted: Promise<void> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __mbPluginsBooted: boolean | undefined;
}

export function bootPlugins(): Promise<void> {
  if (globalThis.__mbPluginsBooted) return Promise.resolve();
  if (!booted) {
    booted = (async () => {
      // Lazy imports keep the module graph acyclic.
      const { default: notificationsPlugin } = await import("@/plugins/notifications");
      const { default: webhooksPlugin } = await import("@/plugins/webhooks");
      const { default: moderationPlugin } = await import("@/plugins/moderation");
      const { default: mcpPlugin } = await import("@/plugins/mcp");
      const { default: exportPlugin } = await import("@/plugins/export");
      const PLUGINS: Plugin[] = [
        notificationsPlugin,
        webhooksPlugin,
        moderationPlugin,
        mcpPlugin,
        exportPlugin,
      ];
      for (const p of PLUGINS) {
        try {
          await p.register(ctx);
          console.log(`[plugins] booted: ${p.name}@${p.version}`);
        } catch (err) {
          console.error(`[plugins] failed to boot ${p.name}:`, err);
        }
      }
      globalThis.__mbPluginsBooted = true;
    })();
  }
  return booted;
}

export { channels, mcpTools, widgets, adminSections };
export type { Plugin, PluginContext };
