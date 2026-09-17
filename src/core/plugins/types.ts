import type { Hookable } from "hookable";
import type { AppEvents } from "@/core/events";

/**
 * Plugin architecture — inspired by Laravel service providers: a plugin gets a
 * `PluginContext` at boot and can register into any extension point. Every
 * first-party feature that is not core-essential (notifications, webhooks,
 * moderation, MCP, export) ships as a built-in plugin, proving the seam.
 */
export interface LocalizedText {
  zh: string;
  en: string;
}

// ---- Notification channels --------------------------------------------
export interface NotificationMessage {
  key: string;
  title: LocalizedText;
  body?: LocalizedText;
  url?: string;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

export interface NotificationChannel {
  id: string;
  label: LocalizedText;
  /** Deliver one notification to one user. Must never throw. */
  send(userId: string, message: NotificationMessage): Promise<void>;
}

// ---- MCP tools ---------------------------------------------------------
export interface McpToolContext {
  userId: string;
  tokenScopes: string[];
}
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scopes: string[];
  handler(args: Record<string, unknown>, ctx: McpToolContext): Promise<unknown>;
}

// ---- Admin panel sections ----------------------------------------------
export interface AdminSectionDef {
  id: string;
  label: LocalizedText;
  href: string;
  icon?: string;
}

// ---- Extension capability registrations --------------------------------
import type {
  MediaProcessor,
} from "@/core/capabilities/media";
import type {
  PostRenderFilter,
} from "@/core/capabilities/post-render";
import type {
  SitemapSourceFn,
} from "@/core/capabilities/sitemap";
import type {
  ExtApiRouteDef,
} from "@/core/capabilities/ext-api";
import type {
  CronTaskDef,
} from "@/core/capabilities/scheduler";
import type { storage } from "@/core/capabilities/storage";
// 只保留 PluginContext 类型签名真正引用的能力符号；能力函数本体由
// extensions/_boot/server.ts 直接 import 并接线（registerXxx/broadcast 等
// 值符号在此仅是类型导入、从未被引用 → 删除，避免 no-unused-vars）。
import type {
  NotificationTemplate,
} from "@/core/capabilities/notify-templates";
import type {
  SearchProvider,
} from "@/core/capabilities/search";
import type {
  Middleware,
} from "@/core/capabilities/actions";
import type {
  listFlagDefs,
} from "@/core/capabilities/flags";
import type { can as policyCan, authorize as policyAuthorize, registerPolicy } from "@/core/capabilities/policies";
import type * as LlmCapability from "@/lib/llm";

// ---- Plugin ------------------------------------------------------------
export interface PluginContext {
  events: AppEvents;
  hooks: Hookable;
  registerChannel(channel: NotificationChannel): void;
  registerMcpTool(tool: McpToolDef): void;
  registerAdminSection(section: AdminSectionDef): void;
  /** 文章渲染管线过滤器（前/后输出、正文改写、meta、打断） */
  registerPostRenderFilter(name: string, fn: PostRenderFilter, order?: number): void;
  /** 媒体上传后处理器 */
  registerMediaProcessor(name: string, fn: MediaProcessor, order?: number): void;
  /** sitemap 额外 URL 源 */
  registerSitemapSource(name: string, fn: SitemapSourceFn): void;
  /** 扩展 API 路由（挂载在 /api/ext/<extensionId>/ 下） */
  registerExtApiRoute(extensionId: string, def: ExtApiRouteDef): void;
  /** 定时任务（cron，pg-boss 原生调度） */
  cron: { register(def: CronTaskDef, handler: () => Promise<void> | void): void };
  /** LLM 能力：chat / 模型目录 / 远端型号查询 / 提示词模板 */
  llm: typeof LlmCapability;
  /** 存储抽象（默认本地适配器，可注册远端） */
  storage: typeof storage;
  /**
   * 授权策略（对象级 ability，Laravel Gate 语义）。
   * 路由/页面角色级 action 策略走 lib/permissions 的 registerPolicy —— 模块级函数，
   * 扩展在自身 server 模块顶层直接调用即可（PluginContext 不重复暴露）。
   */
  policies: {
    register(ability: string, fn: Parameters<typeof registerPolicy>[1]): void;
    can: typeof policyCan;
    authorize: typeof policyAuthorize;
  };
  /** 异步任务（入队/消费，自动绑定扩展命名空间） */
  jobs: {
    dispatch(task: string, payload?: Record<string, unknown>, opts?: { startAfterSeconds?: number; retryLimit?: number; retryDelay?: number }): Promise<string | null>;
    work(task: string, handler: (payload: Record<string, unknown>) => Promise<void> | void): void;
  };
  /** 通知（同步直投 / 异步入队） */
  notifications: {
    send(userId: string, message: NotificationMessage): Promise<void>;
    sendAsync(userId: string, message: NotificationMessage): Promise<void>;
    registerTemplate(key: string, builder: NotificationTemplate): void;
    templates(): string[];
  };
  /** 实时广播（SSE 下发；targets 为用户 id 数组或 "all"） */
  broadcast(targets: string[] | "all", event: { type: string; payload?: unknown }): void;
  /** 搜索 Provider 注册 */
  search: { registerProvider(name: string, fn: SearchProvider): void };
  /**
   * Action 全局中间件注册。
   * 路由级中间件（手写 route 守卫 + Action 管线共享）走 lib/http/middleware 的
   * registerRouteMiddleware —— 模块级函数，扩展在自身 server 模块顶层直接调用即可。
   */
  middleware: { register(m: Middleware): void };
  /** Feature Flags */
  flags: {
    define(key: string, label: string, def?: boolean): void;
    enabled(key: string): Promise<boolean>;
    set(key: string, value: boolean): Promise<void>;
    defs(): ReturnType<typeof listFlagDefs>;
  };
  /** Seeder */
  seeds: { register(name: string, fn: () => Promise<void>): void };
}

export interface Plugin {
  name: string;
  description: string;
  version: string;
  /** 依赖的其他插件名（boot 按此拓扑排序，B4） */
  /**
   * 依赖扩展名列表；支持版本约束条目 `"name@^1.2"`（semver 前缀匹配，
   * boot 拓扑排序时校验，不满足则拒绝启动本插件并告警）。
   */
  requires?: (string | { name: string; version: string })[];
  /** 权限声明（同 manifest.permissions；boot 按 permitted ctx 门控） */
  permissions?: string[];
  /** 信任分级：untrusted 的渲染输出强制净化 */
  trust?: "trusted" | "untrusted";
  /** true ⇒ 延迟注册：首次被容器 resolve（ext.<name>）时才 register（B3） */
  deferred?: boolean;
  register(ctx: PluginContext): void | Promise<void>;
}

// ---- Registries (populated by plugins at boot) --------------------------
// Backed by globalThis so separate module instances (instrumentation chunk
// vs route chunks) share one registry in dev HMR and production builds.
const g = globalThis as unknown as {
  __mbChannels?: Map<string, NotificationChannel>;
  __mbMcpTools?: Map<string, McpToolDef>;
  __mbAdminSections?: Map<string, AdminSectionDef>;
};
export const channels: Map<string, NotificationChannel> = (g.__mbChannels ??= new Map());
export const mcpTools: Map<string, McpToolDef> = (g.__mbMcpTools ??= new Map());
export const adminSections: Map<string, AdminSectionDef> = (g.__mbAdminSections ??= new Map());

export function registerChannel(ch: NotificationChannel) {
  channels.set(ch.id, ch);
}
export function registerMcpTool(t: McpToolDef) {
  mcpTools.set(t.name, t);
}
export function registerAdminSection(s: AdminSectionDef) {
  adminSections.set(s.id, s);
}
