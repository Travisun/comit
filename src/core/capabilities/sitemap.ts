/**
 * sitemap 扩展源 — 核心 sitemap（静态页/用户/文章/话题）之外，扩展可注册
 * 额外的 URL 来源（如活动页、合集聚合页）。单源失败不影响整体输出。
 */
export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

export type SitemapSourceFn = (base: string) => Promise<SitemapEntry[]> | SitemapEntry[];

const g = globalThis as unknown as { __mbSitemapSources?: Map<string, SitemapSourceFn> };
const sources: Map<string, SitemapSourceFn> = (g.__mbSitemapSources ??= new Map());

export function registerSitemapSource(name: string, fn: SitemapSourceFn): void {
  sources.set(name, fn);
}

export async function collectSitemapEntries(base: string): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  for (const [name, fn] of sources) {
    try {
      out.push(...(await fn(base)));
    } catch (err) {
      console.error(`[sitemap:${name}]`, err);
    }
  }
  return out;
}
