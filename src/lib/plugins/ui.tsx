"use client";

import type { ComponentType } from "react";

/**
 * 前端 UI 插件机制 — 与服务端 `src/core/plugins`（PluginContext + 注册表）
 * 同构的客户端镜像：
 *
 *  - 服务端插件在 instrumentation.ts 引导时向 registry 注册 channel / widget；
 *  - 客户端插件在 `src/extensions/_boot/client.tsx`（前端装配点）向槽位注册组件；
 *  - 布局组件不直接 import 具体功能组件，只挂 `<SlotRenderer slot=…>`，
 *    功能（投票、未来的活动/打卡/…）以插件身份自渲染。
 *
 * 约束：槽位 ctx 必须可 JSON 序列化 —— PluginSlot 允许出现在 server
 * component 的 JSX 里（client 边界传 props）。
 */

/** 内容类槽位共用上下文（帖子身份 + 廉价附加物标记） */
export interface PostSlotContext {
  postId: string;
  /** 帖子是否附带投票（PostBrief.hasPoll，列表查询 leftJoin 一次性下发） */
  hasPoll: boolean;
  /** 服务端渲染管线下发的扩展元数据（键约定 ext.<id>.*） */
  meta?: Record<string, unknown>;
}

/** 动作栏槽位上下文（分享/收藏类快捷操作） */
export interface PostActionContext {
  postId: string;
  postType: "article" | "short";
  /** 文章 slug（短动态为 null，分享时用 /p/<id>） */
  slug: string | null;
}

/** 槽位清单 — 新扩展点在此登记 id 与 ctx 形状 */
export interface SlotContexts {
  /** feed/时间线行的尾部（卡片操作区之下，如投票卡片） */
  "feed:row:after": PostSlotContext;
  /** 帖子详情正文之后（短动态详情 / 文章页均可挂载） */
  "post:detail:after": PostSlotContext;
  /** 帖子详情快捷操作栏（点赞/转发一排的扩展动作按钮） */
  "post:actions": PostActionContext;
  /** feed 行「···」快捷菜单的扩展项（组件自行渲染 DropdownMenuItem） */
  "post:row-menu": PostActionContext;
}

export type UiSlotName = keyof SlotContexts;
export type UiSlotComponent<K extends UiSlotName = UiSlotName> = ComponentType<SlotContexts[K]>;

/** distributive pairing：保证 registrations 里 slot 与 component 的 ctx 匹配 */
export interface UiPlugin {
  name: string;
  version: string;
  registrations: { [K in UiSlotName]: { slot: K; component: UiSlotComponent<K> } }[UiSlotName][];
}

interface Registration {
  plugin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
}

// globalThis 承载，dev HMR 下多个模块实例共享一份注册表（与服务端一致）
const g = globalThis as unknown as { __mbUiSlots?: Map<UiSlotName, Registration[]> };
const slots: Map<UiSlotName, Registration[]> = (g.__mbUiSlots ??= new Map());

export function registerUiPlugin(plugin: UiPlugin): void {
  for (const r of plugin.registrations) {
    let list = slots.get(r.slot);
    if (!list) slots.set(r.slot, (list = []));
    list.push({ plugin: plugin.name, component: r.component as Registration["component"] });
  }
}

export function slotComponents(slot: UiSlotName): Registration[] {
  return slots.get(slot) ?? [];
}

/**
 * 槽位渲染器 — 布局/卡片组件在扩展点挂载它，插件组件按注册顺序渲染。
 * 无插件注册时渲染 null（零开销，不产生 DOM）。
 */
export function SlotRenderer<K extends UiSlotName>({ slot, ctx }: { slot: K; ctx: SlotContexts[K] }) {
  const items = slotComponents(slot);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((r, i) => (
        <r.component key={`${r.plugin}#${i}`} {...ctx} />
      ))}
    </>
  );
}

/** 语义化薄封装：调用方不必接触泛型，直接 `<FeedRowAfterSlot postId hasPoll />` */
export function FeedRowAfterSlot(props: SlotContexts["feed:row:after"]) {
  return <SlotRenderer slot="feed:row:after" ctx={props} />;
}

export function PostDetailAfterSlot(props: SlotContexts["post:detail:after"]) {
  return <SlotRenderer slot="post:detail:after" ctx={props} />;
}

export function PostActionsSlot(props: SlotContexts["post:actions"]) {
  return <SlotRenderer slot="post:actions" ctx={props} />;
}

export function PostRowMenuSlot(props: SlotContexts["post:row-menu"]) {
  return <SlotRenderer slot="post:row-menu" ctx={props} />;
}
