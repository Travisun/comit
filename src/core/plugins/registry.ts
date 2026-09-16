import { channels, mcpTools, widgets, adminSections } from "./types";

/**
 * @deprecated 兼容出口 — boot 已迁至 `@/extensions/_boot/server`（扩展目录制）。
 * 注册表本体在 `@/core/plugins/types`。
 *
 * TODO(方向债务)：本文件位于 core/ 却 re-export extensions/_boot 的 bootPlugins，
 * 属 core → extensions 反向依赖。运行时消费方（instrumentation.ts、
 * app/(site)/settings/_data.ts、lib/mcp-transport.ts、app/api/mcp、
 * app/api/me/notifications）全部 `from "@/core/plugins/registry"` 引入
 * bootPlugins/channels/mcpTools，均不在本模块可修改范围内 —— 待这些调用点
 * 统一改引 `@/extensions/_boot/server` 后删除此 re-export，即恢复单向依赖。
 * （core/workers.ts 对扩展模块的顶层 import 已改为处理器内懒加载。）
 */
export { bootPlugins } from "@/extensions/_boot/server";
export { channels, mcpTools, widgets, adminSections };
