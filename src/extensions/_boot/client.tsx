"use client";

/**
 * 前端扩展装配点 — 对应服务端的 `bootPlugins()`（instrumentation.ts 调用）。
 * 扩展的客户端模块在此 import 即完成注册（导航项、rail widget、槽位组件、
 * 打断渲染器均为模块侧效）。新增扩展：import 后加入下方 import 列表即可。
 */
import "@/extensions/poll/client";
import "@/extensions/share/client";
import "@/extensions/signature/client";

export { FeedRowAfterSlot, PostDetailAfterSlot, PostActionsSlot, PostRowMenuSlot } from "@/lib/plugins/ui";
export type { PostSlotContext, PostActionContext, UiPlugin, UiSlotName } from "@/lib/plugins/ui";
