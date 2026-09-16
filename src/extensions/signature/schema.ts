import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * 签名档扩展的数据表 — 扩展自有表以 `ext_<id>_*` 前缀命名，在本文件声明。
 *
 * 迁移机制：表登记进 `extensions/_boot/tables.ts` 后，`pnpm db:generate`
 * 会自动为扩展表生成迁移（版本化进 drizzle journal），
 * `pnpm db:migrate` 统一应用 —— 扩展无需自建迁移运行器。
 */
export const signatureEvents = pgTable("ext_signature_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  /** rendered = 签名被插入正文渲染 */
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
