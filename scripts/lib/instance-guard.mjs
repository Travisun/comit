import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** scripts/lib/instance-guard.mjs → scripts → 项目根（不依赖 cwd） */
const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * dev 依赖实例守卫 — 根治「next 实例路径变化后 .next/dev 增量缓存残留」。
 *
 * 背景：pnpm 下任何改变 next 安装目录名的事件（react/react-dom 升级改变
 * peer hash、pnpm patch 的增删改）都会更换 node_modules/next 符号链接的
 * 指向，而 Turbopack dev 的持久缓存（.next/dev/cache）按**绝对模块路径**
 * 记录编译产物，对这种变化不会完全失效——引用已消失旧路径的编译单元会被
 * 继续发给浏览器，与新代际模块混用，产生 "module factory is not available" /
 * flight 重复 resolve / unhandledRejection(startsWith) 一类连环错误
 * （本项目 2026-09 连续两天幽灵故障的根因）。
 *
 * 策略（保守：无法证明缓存连续性就清除，冷编译代价远小于幽灵错误）：
 *   1. ref 状态存于 node_modules/.cache/mb-next-ref —— 刻意放在 .next 之外，
 *      .next 被任何人/任何工具清掉都不会丢状态；
 *   2. ref 变化且存在 .next/dev → 清除；
 *   3. ref 缺失（全新安装/状态丢失）但 .next/dev 存在 → 一并清除
 *      （缓存代际出处无法证明）；
 *   4. ref 未变化 → 不动。
 *
 * 双入口：scripts/postinstall.mjs（依赖安装时）与 next.config.ts
 * （每次 dev/build/start 启动、编译开始前）都调用本守卫，覆盖
 * 「dev server 运行期间执行了 pnpm install」与「手动清 .next」两类窗口。
 *
 * @param {{ root?: string, log?: (msg: string) => void }} [options]
 * @returns {boolean} 本次是否清除了 .next/dev
 */
export function runInstanceGuard(options = {}) {
  const { root = PROJECT_ROOT, log = () => {} } = options;
  try {
    const refFile = join(root, "node_modules", ".cache", "mb-next-ref");
    const nextLink = join(root, "node_modules", "next");
    const devCache = join(root, ".next", "dev");

    const ref = existsSync(nextLink) ? readlinkSync(nextLink) : "";
    const prev = existsSync(refFile) ? readFileSync(refFile, "utf8") : null;

    const shouldClear =
      existsSync(devCache) && (prev === null || prev !== ref);
    if (shouldClear) {
      rmSync(devCache, { recursive: true, force: true });
    }

    mkdirSync(dirname(refFile), { recursive: true });
    writeFileSync(refFile, ref);

    if (shouldClear) {
      log(
        "[instance-guard] next 实例路径变化或状态缺失 → 已清除 .next/dev 编译缓存（防新旧代际 chunk 混用）",
      );
    }
    return shouldClear;
  } catch {
    // 守卫自身失败绝不阻断安装/启动
    return false;
  }
}
