import type { ComponentType } from "react";
import { SignaturePage } from "@/extensions/signature/client";

/**
 * 扩展页面 / 设置面板的**静态**注册表（双端可导入的纯模块）。
 * 页面路由（/e/<path>）与设置面板由 server/client 组件共同消费：
 * server component 无法读取 "use client" 注册表的运行时状态，因此这一类
 * 「需要被服务端渲染树直接引用」的贡献点用静态 import 装配。
 */

export interface ExtensionPageRef {
  /** 挂载在 /e/ 下的路径，如 "signature" → /e/signature */
  path: string;
  title: string;
  /** site ⇒ 三栏站点壳；bare ⇒ 无侧栏全屏（auth 页同款） */
  layout: "site" | "bare";
  component: ComponentType;
}

export const EXTENSION_PAGES: ExtensionPageRef[] = [
  { path: "signature", title: "签名档", layout: "bare", component: SignaturePage },
];

export function getExtensionPage(path: string): ExtensionPageRef | null {
  return EXTENSION_PAGES.find((p) => p.path === path) ?? null;
}
