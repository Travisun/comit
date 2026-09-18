import type { ReactNode } from "react";
import { getSetting } from "@/lib/settings";

/**
 * Shared layout for /legal/* documents — 以中文为标准的正式法律文档版式：
 * 文档头（标题 + 版本时间 + 阅读提示）、正文（article-prose）、
 * 可选的英文对照段落（默认不使用；需要双语时传 en）。
 */

/** 文档头品牌行随 admin 站点设置（site.name）变化。 */
export async function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  const siteName = await getSetting("site.name");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <article className="article-prose">
        {/* 文档头卡片：正式文档的版本信息位 */}
        <header className="not-prose mb-8 rounded-2xl border border-border/70 bg-card p-6 shadow-[var(--shadow-soft)]">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
            {siteName} · legal
          </p>
          <h1 className="!mt-2 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">最后更新：{updated} · 生效即日</p>
          <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
            本文档以中文为标准版本。如对条款有任何疑问，请通过页脚联系方式与我们沟通；
            继续使用本平台即表示你已阅读并理解相关条款。
          </p>
        </header>
        {children}
      </article>
    </div>
  );
}

export function LegalSection({
  title,
  children,
  en,
}: {
  title: string;
  /** 中文正文（标准版本） */
  children: ReactNode;
  /** 可选英文对照（默认不使用；中文为标准文本） */
  en?: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
      {en ? (
        <details>
          <summary>English</summary>
          <div className="text-[0.95em] text-muted-foreground [&_h3]:!mt-4 [&_p]:!mt-2">{en}</div>
        </details>
      ) : null}
    </section>
  );
}
