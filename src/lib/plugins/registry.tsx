"use client";

import { useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import type { PostRenderInterrupt } from "@/core/capabilities/post-render";
import { PluginErrorBoundary } from "./error-boundary";

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

// 注册表响应式:HMR / 异步装配下注册发生在渲染之后时,消费端需能感知变化。
// version + listeners 同样挂 globalThis,保证多模块实例共享同一通知通道。
const gSub = globalThis as unknown as {
  __mbUiRegistrySubs?: Set<() => void>;
  __mbUiRegistryVer?: number;
};
const listeners: Set<() => void> = (gSub.__mbUiRegistrySubs ??= new Set());

function notifyRegistryChanged(): void {
  gSub.__mbUiRegistryVer = (gSub.__mbUiRegistryVer ?? 0) + 1;
  for (const l of listeners) l();
}

/** 注册表版本号 — 0 = SSR/hydration 首帧（空表），>0 = 至少发生过一次注册。 */
export function markUiRegistryChanged(): void {
  notifyRegistryChanged();
}

export function subscribeUiRegistry(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getUiRegistryVersion(): number {
  return gSub.__mbUiRegistryVer ?? 0;
}

/**
 * hydration 用 server snapshot — 恒为 0（空注册表）。注册发生在客户端模块
 * 侧效（_boot/client），SSR 进程里注册表恒空而浏览器端在 hydration 前可能
 * 已注入：若 hydration 渲染读真实 version，SSR HTML 与首帧必然失配
 * （Next #1 hydration error）。固定 0 让扩展 UI 统一在 mount 后补挂。
 */
export function getServerUiRegistryVersion(): number {
  return 0;
}

/** 消费端 hook:注册表变化时触发重渲（useSyncExternalStore 的三件套拆开用）。 */
export function useUiRegistryVersion(): number {
  return useSyncExternalStore(subscribeUiRegistry, getUiRegistryVersion, getServerUiRegistryVersion);
}

function sorted<T extends { order?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function registerNavItem(def: NavItemDef): void {
  reg.navItems = sorted([...reg.navItems.filter((x) => x.id !== def.id), def]);
  notifyRegistryChanged();
}

export function registerUserMenuItem(def: UserMenuItemDef): void {
  reg.userMenuItems = sorted([...reg.userMenuItems.filter((x) => x.id !== def.id), def]);
  notifyRegistryChanged();
}

export function registerRailWidget(def: RailWidgetDef): void {
  reg.railWidgets = sorted([...reg.railWidgets.filter((x) => x.id !== def.id), def]);
  notifyRegistryChanged();
}

/** 按打断原因码注册替代渲染器（如付费墙 / 登录可见卡片）。 */
export function registerInterruptRenderer(code: string, renderer: InterruptRenderer): void {
  reg.interruptRenderers.set(code, renderer);
  notifyRegistryChanged();
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

/** 右栏扩展 widget 组 — SiteRail（服务端）末尾挂载（客户端组件）。
 *  每个 widget 独立错误边界:单个扩展抛错只降级自身,上报后不影响其余
 *  widget 与宿主布局。 */
export function ExtensionRailWidgets() {
  const version = useUiRegistryVersion();
  // version 0 ⇒ hydration 首帧,与 SSR（恒空表）保持一致渲染 null,挂载后补显
  const widgets = version === 0 ? [] : getRailWidgets();
  if (widgets.length === 0) return null;
  return (
    <>
      {widgets.map((w) => {
        const Widget = w.component;
        return (
          <PluginErrorBoundary key={w.id} scope={`rail:${w.id}`}>
            <Widget />
          </PluginErrorBoundary>
        );
      })}
    </>
  );
}

/** 通用打断渲染视图 — 服务端详情页在管线被打断时挂载（客户端组件）。 */
export function InterruptView({ info }: { info: PostRenderInterrupt }) {
  const version = useUiRegistryVersion();
  // hydration 首帧（version 0）先渲染服务端同款 fallback，挂载后再换扩展渲染器
  // 注册表查找 — 渲染器是注册期创建的稳定引用，并非 render 期新建组件
  const Renderer = version === 0 ? null : getInterruptRenderer(info.code);
  const fallback = (
    <div className="my-6 rounded-xl border border-border bg-muted/40 p-6 text-center">
      <p className="text-sm font-medium">{info.message ?? "内容暂不可见"}</p>
    </div>
  );
  if (Renderer)
    return (
      <PluginErrorBoundary scope={`interrupt:${info.code}`} fallback={fallback}>
        {/* eslint-disable-next-line react-hooks/static-components -- 注册期稳定引用,非 render 期新建 */}
        <Renderer info={info} />
      </PluginErrorBoundary>
    );
  return fallback;
}
