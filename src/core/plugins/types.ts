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

// ---- Sidebar widgets ---------------------------------------------------
export interface WidgetDef {
  id: string;
  label: LocalizedText;
  /** default visibility on new profiles */
  default: boolean;
}

// ---- Admin panel sections ----------------------------------------------
export interface AdminSectionDef {
  id: string;
  label: LocalizedText;
  href: string;
  icon?: string;
}

// ---- Plugin ------------------------------------------------------------
export interface PluginContext {
  events: AppEvents;
  hooks: Hookable;
  registerChannel(channel: NotificationChannel): void;
  registerMcpTool(tool: McpToolDef): void;
  registerWidget(widget: WidgetDef): void;
  registerAdminSection(section: AdminSectionDef): void;
}

export interface Plugin {
  name: string;
  description: string;
  version: string;
  register(ctx: PluginContext): void | Promise<void>;
}

// ---- Registries (populated by plugins at boot) --------------------------
// Backed by globalThis so separate module instances (instrumentation chunk
// vs route chunks) share one registry in dev HMR and production builds.
const g = globalThis as unknown as {
  __mbChannels?: Map<string, NotificationChannel>;
  __mbMcpTools?: Map<string, McpToolDef>;
  __mbWidgets?: Map<string, WidgetDef>;
  __mbAdminSections?: Map<string, AdminSectionDef>;
};
export const channels: Map<string, NotificationChannel> = (g.__mbChannels ??= new Map());
export const mcpTools: Map<string, McpToolDef> = (g.__mbMcpTools ??= new Map());
export const widgets: Map<string, WidgetDef> = (g.__mbWidgets ??= new Map());
export const adminSections: Map<string, AdminSectionDef> = (g.__mbAdminSections ??= new Map());

export function registerChannel(ch: NotificationChannel) {
  channels.set(ch.id, ch);
}
export function registerMcpTool(t: McpToolDef) {
  mcpTools.set(t.name, t);
}
export function registerWidget(w: WidgetDef) {
  widgets.set(w.id, w);
}
export function registerAdminSection(s: AdminSectionDef) {
  adminSections.set(s.id, s);
}
