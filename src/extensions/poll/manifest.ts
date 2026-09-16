import type { ExtensionManifest } from "@/core/capabilities/manifest";

/** 投票扩展 — 前端槽位（feed:row:after / post:detail:after）+ 到期通知任务。 */
const manifest = {
  id: "poll",
  title: { zh: "投票", en: "Poll" },
  description: {
    zh: "在短动态中发起投票，到期自动通知参与者。",
    en: "Polls on short posts with automatic end-of-poll notifications.",
  },
  version: "1.0.0",
} satisfies ExtensionManifest;

export default manifest;
