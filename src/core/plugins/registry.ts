import { channels, mcpTools, widgets, adminSections } from "./types";

/**
 * @deprecated 兼容出口 — boot 已迁至 `@/extensions/_boot/server`（扩展目录制）。
 * 注册表本体在 `@/core/plugins/types`。
 */
export { bootPlugins } from "@/extensions/_boot/server";
export { channels, mcpTools, widgets, adminSections };
