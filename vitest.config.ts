import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * 扩展测试配置 — 约定：测试放 `src/extensions/<id>/tests/*.test.ts`。
 * 运行：`pnpm test`（全部）或 `pnpm ext test <id>`（单扩展，自动过滤）。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 数据库相关工厂测试需要 DATABASE_URL；纯函数测试（模型/校验/清单）无外部依赖
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
