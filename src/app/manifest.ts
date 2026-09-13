import type { MetadataRoute } from "next";
import { config } from "@/core/config";

/** PWA web app manifest — served at /manifest.webmanifest via metadata.manifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${config.app.name} — Commit your ideas.`,
    short_name: config.app.name,
    description:
      "为极客、设计师、科学家与领域学子打造的个人主页社交网络：科研日志、研究发布与项目动态。",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f5f5",
    theme_color: "#24292f",
    lang: "zh-CN",
    categories: ["social", "productivity", "blogging"],
    icons: [
      { src: "/icons/favicon@128w.png", sizes: "128x128", type: "image/png" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
