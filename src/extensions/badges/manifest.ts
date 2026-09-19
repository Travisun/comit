import type { ExtensionManifest } from "@/core/capabilities/manifest";

export const manifest: ExtensionManifest = {
  id: "badges",
  title: { zh: "徽章头衔", en: "Badges" },
  description: {
    zh: "社区荣誉徽章体系：后台定制与颁发，用户佩戴（最多 3 枚）并在内容与主页展示。",
    en: "Community badge system: admin-curated badges, wear up to 3, shown across posts and profiles.",
  },
  version: "1.0.0",
};
