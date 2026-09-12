import type { ReactNode } from "react";

/**
 * Shared layout for /legal/* documents: zh-first sections with a collapsed
 * English rendering of each section (uniform across all legal pages).
 */

export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <article className="article-prose">
        <h1 className="!mt-0">{title}</h1>
        <p className="text-sm text-muted-foreground">最后更新 / Last updated：{updated}</p>
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
  /** Chinese (primary) content */
  children: ReactNode;
  /** English rendering, collapsed by default */
  en: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
      <details>
        <summary>English</summary>
        <div className="text-[0.95em] text-muted-foreground [&_h3]:!mt-4 [&_p]:!mt-2">{en}</div>
      </details>
    </section>
  );
}
