import { cache } from "@/core/cache";

/**
 * Feature Flags（D3）— 运行时开关，存 settings 表（`flag.<key>`），
 * 读取走 5s 进程缓存。扩展与平台共用（UI 开关后续接入管理端）。
 */
export interface FlagDef {
  key: string;
  label: string;
  default: boolean;
}

const g = globalThis as unknown as { __mbFlags?: Map<string, FlagDef> };
const defs: Map<string, FlagDef> = (g.__mbFlags ??= new Map());

export function defineFlag(key: string, label: string, def = false): void {
  defs.set(key, { key, label, default: def });
}

export async function flagEnabled(key: string): Promise<boolean> {
  const { getSetting } = await import("@/lib/settings");
  const def = defs.get(key);
  const v = await cache.remember(`flag.${key}`, 5_000, async () => {
    const raw = await getSetting(`flag.${key}` as never).catch(() => undefined);
    return typeof raw === "boolean" ? raw : (def?.default ?? false);
  });
  return Boolean(v);
}

export async function setFlag(key: string, value: boolean): Promise<void> {
  const { setSetting } = await import("@/lib/settings");
  await setSetting(`flag.${key}` as never, value);
  cache.forget(`flag.${key}`);
}

export function listFlagDefs(): FlagDef[] {
  return [...defs.values()];
}

