import Link from "next/link";
import { Rss } from "lucide-react";
import { config } from "@/core/config";
import { routes } from "@/core/routes";

/**
 * Slim, X-density footer: a quiet link strip for routes without the right
 * rail (the shell rail carries the same links on desktop). No card, no shadow.
 */
export function SiteFooter({ locale }: { locale: "zh" | "en" }) {
  const zh = locale === "zh";
  const link = "hover:underline underline-offset-2";
  return (
    <footer className="px-4 py-6 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-[600px] flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground/70">
          {config.app.name}
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
        <span>
          © {new Date().getFullYear()} {config.app.name} · {zh ? "由 comit.sh 驱动" : "Powered by comit.sh"}
        </span>
      </div>
    </footer>
  );
}
