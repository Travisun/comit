/** 搜索抽象（D8，Scout 对应物）— 统一入口 + 可注册 Provider，聚合去重。 */
export interface SearchHit {
  type: string;
  id: string;
  title: string;
  url: string;
  excerpt?: string;
  score?: number;
}

export type SearchProvider = (q: string, limit: number) => Promise<SearchHit[]>;

const g = globalThis as unknown as { __mbSearchProviders?: Map<string, SearchProvider> };
const providers: Map<string, SearchProvider> = (g.__mbSearchProviders ??= new Map());

export function registerSearchProvider(name: string, fn: SearchProvider): void {
  providers.set(name, fn);
}

export async function searchAll(q: string, limit = 10): Promise<Record<string, SearchHit[]>> {
  const needle = q.trim();
  const out: Record<string, SearchHit[]> = {};
  for (const [name, fn] of providers) {
    out[name] = [];
    if (!needle) continue;
    try {
      out[name] = (await fn(needle.slice(0, 80), limit)).slice(0, limit);
    } catch (err) {
      console.error(`[search:${name}]`, err);
    }
  }
  return out;
}
