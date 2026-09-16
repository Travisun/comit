/** 扩展 Seeder（C3）— `pnpm ext seed` 执行；完成标记存 settings 防重放。 */
type SeedFn = () => Promise<void>;

const g = globalThis as unknown as { __mbSeeds?: Map<string, SeedFn> };
const seeds: Map<string, SeedFn> = (g.__mbSeeds ??= new Map());

export function registerSeed(name: string, fn: SeedFn): void {
  seeds.set(name, fn);
}

export async function runSeeds(): Promise<string[]> {
  const { getSetting, setSetting } = await import("@/lib/settings");
  const done: string[] = [];
  for (const [name, fn] of seeds) {
    const already = await getSetting(`seeds.done.${name}` as never).catch(() => undefined);
    if (already) continue;
    try {
      await fn();
      await setSetting(`seeds.done.${name}` as never, new Date().toISOString());
      done.push(name);
      console.log(`[seed] ${name} ✓`);
    } catch (err) {
      console.error(`[seed] ${name} failed:`, err);
    }
  }
  return done;
}
