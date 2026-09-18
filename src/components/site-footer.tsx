import Link from "next/link";
import { Rss } from "lucide-react";
import { routes } from "@/core/routes";
import type { SiteBrand } from "@/lib/settings";

/**
 * Slim, X-density footer: a quiet link strip for routes without the right
 * rail (the shell rail carries the same links on desktop). No card, no shadow.
 * 品牌名/版权行/备案号来自 admin 站点设置（site.name / site.copyright /
 * site.beian）；版权行留空时用 `© {年份} {站点名}` 默认。
 */
export function SiteFooter({ locale, brand }: { locale: "zh" | "en"; brand: SiteBrand }) {
  const zh = locale === "zh";
  const link = "hover:underline underline-offset-2";
  const copyright = brand.copyright.trim() || `© ${new Date().getFullYear()} ${brand.name}`;
  return (
    <footer className="px-4 py-6 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-[600px] flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground/70">
          {brand.name}
        </span>
        <span>{zh ? "内容版权归作者所有" : "Content belongs to its authors"}</span>
        <Link href={routes.legal.terms} className={link} prefetch={false}>
          {zh ? "服务协议" : "Terms"}
        </Link>
        <Link href={routes.legal.privacy} className={link} prefetch={false}>
          {zh ? "隐私政策" : "Privacy"}
        </Link>
        <Link href="/legal/copyright" className={link} prefetch={false}>
          {zh ? "版权声明" : "Copyright"}
        </Link>
        <Link href="/about" className={link} prefetch={false}>
          {zh ? "关于" : "About"}
        </Link>
        <Link href={routes.globalRss} className={`${link} inline-flex items-center gap-1`} prefetch={false}>
          <Rss className="size-3" /> RSS
        </Link>
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{copyright}</span>
          {brand.beian.trim() && (
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer nofollow"
              className={link}
            >
              {brand.beian.trim()}
            </a>
          )}
          <span>
            {zh ? `由 ${brand.name} 驱动` : `Powered by ${brand.name}`}
          </span>
        </span>
      </div>
    </footer>
  );
}
