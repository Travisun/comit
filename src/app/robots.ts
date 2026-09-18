import type { MetadataRoute } from "next";
import { config } from "@/core/config";
import { getSiteBrand } from "@/lib/settings";

/**
 * robots.txt — 默认 index everything public; keep app areas out。
 * admin 设置 site.noindex（私有实例）⇒ 全站 Disallow；值随请求读取
 * （force-dynamic），后台开关即时生效。
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const brand = await getSiteBrand();
  return {
    rules: [
      {
        userAgent: "*",
        ...(brand.noindex ? { disallow: ["/"] } : { allow: "/", disallow: ["/admin", "/admin/", "/settings", "/settings/", "/api/"] }),
      },
    ],
    sitemap: brand.noindex ? undefined : `${config.app.url.replace(/\/$/, "")}/sitemap.xml`,
  };
}
