import type { ComponentType } from "react";

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
  /**
   * 页面布局：缺省 "site" —— 继承站点三栏壳，页面内容渲染在中间内容区
   * （绝大多数设置/工具类页面的正确形态）；"bare" 显式声明才走无侧栏全屏
   * （如签名档这类画布型页面）。
   */
  layout?: "site" | "bare";
  component: ComponentType;
}

export const EXTENSION_PAGES: ExtensionPageRef[] = [];

export function getExtensionPage(path: string): ExtensionPageRef | null {
  return EXTENSION_PAGES.find((p) => p.path === path) ?? null;
}
