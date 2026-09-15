"use client";

/**
 * 前端插件装配点 — 对应服务端的 `bootPlugins()`（instrumentation.ts 调用）。
 * 新增内置 UI 插件：import 后加入数组即可，所有挂了对应 SlotRenderer 的
 * 布局自动生效，无需改动布局代码。
 *
 * 本文件是 client 边界：保证注册副作用与 SlotRenderer 处于同一客户端模块
 * 图，server component 里 import 这里的 Slot 薄封装即可安全挂载。
 */
import { registerUiPlugin } from "@/lib/plugins/ui";
import { pollUiPlugin } from "./poll";

const UI_PLUGINS = [pollUiPlugin];

for (const p of UI_PLUGINS) {
  registerUiPlugin(p);
}

export { FeedRowAfterSlot, PostDetailAfterSlot, SlotRenderer } from "@/lib/plugins/ui";
export type { PostSlotContext, UiPlugin, UiSlotName } from "@/lib/plugins/ui";
