import { boolean, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "@/db/schema";

/**
 * 徽章/头衔扩展表（约定前缀 ext_badges_*，经 _boot/tables 聚合进 drizzle）。
 *
 * - ext_badges        徽章目录（后台可定制：名称/佩戴文字/图标/样式）
 * - ext_badge_grants   颁发记录（用户 ↔ 徽章，唯一；荣誉永久保留）
 * - ext_badge_wear     佩戴状态（每用户最多 3 枚，写入时由 API 校验上限）
 */
export const extBadges = pgTable("ext_badges", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 稳定标识（种子与策略引用用），如 official / genesis */
  key: varchar("key", { length: 40 }).notNull(),
  name: varchar("name", { length: 40 }).notNull(),
  /** 佩戴时展示的短文字（默认同 name） */
  text: varchar("text", { length: 24 }).notNull(),
  /** 图标标识（见 badges/styles.ts 的 BADGE_ICONS 白名单） */
  icon: varchar("icon", { length: 24 }).notNull().default("medal"),
  /** 样式预设（见 badges/styles.ts 的 BADGE_STYLES 白名单） */
  style: varchar("style", { length: 24 }).notNull().default("slate"),
  description: varchar("description", { length: 200 }),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("ext_badges_key_key").on(t.key)]);

export const extBadgeGrants = pgTable("ext_badge_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  badgeId: uuid("badge_id")
    .notNull()
    .references(() => extBadges.id, { onDelete: "cascade" }),
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  note: varchar("note", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ext_badge_grants_user_badge_key").on(t.userId, t.badgeId),
  index("ext_badge_grants_user_idx").on(t.userId),
]);

export const extBadgeWear = pgTable("ext_badge_wear", {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  badgeId: uuid("badge_id")
    .notNull()
    .references(() => extBadges.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.badgeId] }),
  index("ext_badge_wear_user_idx").on(t.userId),
]);
