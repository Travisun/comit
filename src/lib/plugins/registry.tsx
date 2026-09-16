"use client";

import type { ComponentType } from "react";
import type { PostRenderInterrupt } from "@/core/capabilities/post-render";

/**
 * 客户端扩展注册表（命令式 UI 贡献点）— 与服务端 PluginContext 对称：
 *  - 导航项 / 用户菜单项 / 右栏 widget：数据式贡献，由 shell 消费；
 *  - 渲染打断 UI：按打断原因码匹配渲染器（付费墙/登录可见等）。
 * 声明式贡献（设置字段/资料字段）走 manifest（core/capabilities/manifest.ts）。
 */

export interface LocalizedLabel {
  zh: string;
  en: string;
}

export interface NavItemDef {
  id: string;
  label: LocalizedLabel;
  href: string;
  /** lucide 图标组件（可选） */
  icon?: ComponentType<{ className?: string }>;
  /** user ⇒ 仅登录可见；默认 all */
  audience?: "all" | "user";
  order?: number;
}

export interface UserMenuItemDef {
  id: string;
  label: LocalizedLabel;
  href: string;
  order?: number;
}

export interface RailWidgetDef {
  id: string;
  title?: LocalizedLabel;
  component: ComponentType;
  order?: number;
}

export type InterruptRenderer = ComponentType<{ info: PostRenderInterrupt }>;

interface Registry {
  navItems: NavItemDef[];
  userMenuItems: UserMenuItemDef[];
  railWidgets: RailWidgetDef[];
  interruptRenderers: Map<string, InterruptRenderer>;
}

const g = globalThis as unknown as { __mbUiRegistry?: Registry };
const reg: Registry = (g.__mbUiRegistry ??= {
  navItems: [],
  userMenuItems: [],
  railWidgets: [],
  interruptRenderers: new Map(),
});

function sorted<T extends { order?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function registerNavItem(def: NavItemDef): void {
  reg.navItems = sorted([...reg.navItems.filter((x) => x.id !== def.id), def]);
}

export function registerUserMenuItem(def: UserMenuItemDef): void {
  reg.userMenuItems = sorted([...reg.userMenuItems.filter((x) => x.id !== def.id), def]);
}

export function registerRailWidget(def: RailWidgetDef): void {
  reg.railWidgets = sorted([...reg.railWidgets.filter((x) => x.id !== def.id), def]);
}

/** 按打断原因码注册替代渲染器（如付费墙 / 登录可见卡片）。 */
export function registerInterruptRenderer(code: string, renderer: InterruptRenderer): void {
  reg.interruptRenderers.set(code, renderer);
}

export function getNavItems(audience: "all" | "user"): NavItemDef[] {
  return reg.navItems.filter((x) => (x.audience ?? "all") === "all" || audience === "user");
}

export function getUserMenuItems(): UserMenuItemDef[] {
  return sorted(reg.userMenuItems);
}

export function getRailWidgets(): RailWidgetDef[] {
  return sorted(reg.railWidgets);
}

export function getInterruptRenderer(code: string): InterruptRenderer | null {
  // 精确匹配优先，其次前缀匹配（ext.<id>.* 的扩展级兜底）
  return (
    reg.interruptRenderers.get(code) ??
    [...reg.interruptRenderers.entries()].find(([k]) => code.startsWith(`${k}.`))?.[1] ??
    null
  );
}

/** 右栏扩展 widget 组 — SiteRail（服务端）末尾挂载（客户端组件）。 */
export function ExtensionRailWidgets() {
  const widgets = getRailWidgets();
  if (widgets.length === 0) return null;
  return (
    <>
      {widgets.map((w) => {
        const Widget = w.component;
        return <Widget key={w.id} />;
      })}
    </>
  );
}

/** 通用打断渲染视图 — 服务端详情页在管线被打断时挂载（客户端组件）。 */
export function InterruptView({ info }: { info: PostRenderInterrupt }) {
  // 注册表查找 — 渲染器是注册期创建的稳定引用，并非 render 期新建组件
  const Renderer = getInterruptRenderer(info.code);
  if (Renderer)
    // eslint-disable-next-line react-hooks/static-components
    return <Renderer info={info} />;
  return (
    <div className="my-6 rounded-xl border border-border bg-muted/40 p-6 text-center">
      <p className="text-sm font-medium">{info.message ?? "内容暂不可见"}</p>
    </div>
  );
}
