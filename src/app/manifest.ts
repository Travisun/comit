import type { MetadataRoute } from "next";
import { config } from "@/core/config";
import { getLocale } from "@/lib/i18n";

/** PWA web app manifest — served at /manifest.webmanifest via metadata.manifest. */
// lang 随站点 locale cookie 变化 → 请求时动态生成
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // 与 layout 的 <html lang> 同源（mb_locale cookie，取不到默认 zh）
  const locale = await getLocale();
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
    lang: locale === "zh" ? "zh-CN" : "en",
    categories: ["social", "productivity", "blogging"],
    icons: [
      { src: "/icons/logo-mark.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/logo-mark-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      {
        src: "/icons/logo-mark-256.png",
        sizes: "256x256",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
