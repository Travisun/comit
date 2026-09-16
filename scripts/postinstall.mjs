import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";

/**
 * pnpm postinstall 守卫 — 根治「依赖实例路径变化后 Turbopack 增量缓存残留」。
 *
 * 背景:pnpm 升级/打补丁会更换 node_modules/next 的实例目录
 * (如 next@16.3.5_... → next@16.3.5_patch_hash=...),而 Turbopack 的
 * .next/dev 增量编译缓存对这种变化**不会完全失效**——引用旧实例路径的
 * 编译单元被继续发给浏览器,与新代际模块混用,产生
 * "module factory is not available" / enqueueModel 一类的致命错误。
 *
 * 规则:记录上次安装时 node_modules/next 的符号链接指向;一旦变化,
 * 清除 .next/dev(仅 dev 编译缓存,不影响生产构建产物)。
 */
try {
  const ref = existsSync("node_modules/next") ? readlinkSync("node_modules/next") : "";
  const refFile = ".next/.mb-next-ref";
  const prev = existsSync(refFile) ? readFileSync(refFile, "utf8") : null;

  if (prev !== null && prev !== ref && existsSync(".next/dev")) {
    rmSync(".next/dev", { recursive: true, force: true });
    console.log(
      "[postinstall] next 实例路径已变化 → 已清除 .next/dev 编译缓存(防止新旧代际 chunk 混用)",
    );
  }

  mkdirSync(".next", { recursive: true });
  writeFileSync(refFile, ref);
} catch {
  /* 守卫自身失败绝不阻断安装 */
}
