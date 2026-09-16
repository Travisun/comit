/**
 * 扩展数据表聚合 — 扩展在 `extensions/<id>/schema.ts` 声明 drizzle 表后
 * 在此 re-export。db/schema.ts 再 re-export 本文件，因此：
 *   `pnpm db:generate` 自动为扩展表产出迁移（版本化进 journal），
 *   `pnpm db:migrate` 统一应用；运行时 `import { db } from "@/db"` 直接访问。
 *
 * 新扩展登记（一行）：
 *   export * from "@/extensions/<id>/schema";
 */
export * from "@/extensions/signature/schema";
