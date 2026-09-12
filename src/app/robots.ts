import type { MetadataRoute } from "next";
import { config } from "@/core/config";

/** robots.txt — index everything public; keep app areas out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/settings", "/settings/", "/api/"],
      },
    ],
    sitemap: `${config.app.url.replace(/\/$/, "")}/sitemap.xml`,
  };
}
