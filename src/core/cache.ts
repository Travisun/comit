/**
 * 应用缓存（D2，Laravel Cache 对应物）— 内存实现（单进程部署足够），
 * `remember(key, ttl, fn)` + 标签失效。水平扩展时更换 Redis 后端仅需
 * 替换本文件的 backend，调用面不变。
 */

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

const g = globalThis as unknown as { __mbCache?: Map<string, Entry> };
const store: Map<string, Entry> = (g.__mbCache ??= new Map());

const MAX_ENTRIES = 2_000;

function prune(now: number) {
  for (const [k, e] of store) {
    if (e.expiresAt <= now) store.delete(k);
  }
  if (store.size > MAX_ENTRIES) {
    let dropped = 0;
    const excess = store.size - MAX_ENTRIES;
    for (const k of store.keys()) {
      store.delete(k);
      if (++dropped >= excess) break;
    }
  }
}

export const cache = {
  /** 命中返回缓存值；未命中执行 fn 并写入（fn 的异步错误不缓存）。 */
  async remember<T>(key: string, ttlMs: number, fn: () => Promise<T> | T, tags: string[] = []): Promise<T> {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await fn();
    store.set(key, { value, expiresAt: now + ttlMs, tags });
    prune(now);
    return value;
  },

  get<T>(key: string): T | undefined {
    const e = store.get(key);
    if (!e || e.expiresAt <= Date.now()) return undefined;
    return e.value as T;
  },

  put(key: string, value: unknown, ttlMs: number, tags: string[] = []): void {
    store.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
    prune(Date.now());
  },

  forget(key: string): void {
    store.delete(key);
  },

  /** 按标签失效（写入时声明的 tags）。 */
  flushTags(...tags: string[]): void {
    for (const [k, e] of store) {
      if (e.tags.some((t) => tags.includes(t))) store.delete(k);
    }
  },

  flush(): void {
    store.clear();
  },
};
