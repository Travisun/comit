import type { ExtensionManifest } from "@/core/capabilities/manifest";

/** 复制链接扩展 — 动作栏/行菜单槽位的最小示范（无设置、无服务端）。 */
const manifest = {
  id: "share",
  title: { zh: "复制链接", en: "Copy link" },
  description: {
    zh: "在帖子详情与时间线快捷菜单中提供「复制链接」。",
    en: "Adds a copy-link action to post detail and row menus.",
  },
  version: "1.0.0",
} satisfies ExtensionManifest;

export default manifest;
