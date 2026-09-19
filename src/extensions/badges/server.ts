import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { extBadgeGrants, extBadges, extBadgeWear, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { sendOperationNotification } from "@/lib/operation-notify";
import type { Plugin } from "@/core/plugins/types";

/**
 * 徽章/头衔扩展 — 后台定制与颁发，用户佩戴（≤ WEAR_LIMIT 枚）后全站展示。
 *
 * 展示数据出口：getWornBadgesByUsernames(usernames) → Map<username, WornBadge[]>
 * （feed 卡片 / 详情作者栏 / 评论等调用方按作者批量取用）。
 */

export const WEAR_LIMIT = 3;

/** 创世徽章注册截止（北京时间 2026-09-26 00:00）。 */
export const GENESIS_DEADLINE_MS = new Date("2026-09-25T16:00:00.000Z").getTime();

/** 种子徽章（幂等：按 key onConflictDoNothing，后台可再编辑）。 */
const SEED_BADGES = [
  { key: "official", name: "官方", text: "官方", icon: "shield", style: "official", sortOrder: 10,
    description: "平台官方团队标识" },
  { key: "ops", name: "运营", text: "运营", icon: "wrench", style: "ops", sortOrder: 20,
    description: "社区运营团队成员" },
  { key: "admin", name: "管理", text: "管理", icon: "crown", style: "admin", sortOrder: 30,
    description: "社区管理团队成员" },
  { key: "genesis", name: "创世", text: "创世", icon: "sparkles", style: "genesis", sortOrder: 40,
    description: "创世时期加入社区的早期成员" },
  { key: "l-lao", name: "L佬", text: "L佬", icon: "zap", style: "dev", sortOrder: 45,
    description: "通过 Linux.do SSO 接入社区的成员" },
  { key: "cute", name: "小可爱", text: "小可爱", icon: "heart", style: "cute", sortOrder: 50,
    description: "社区活动派发的荣誉头衔" },
  { key: "writer", name: "大作家", text: "大作家", icon: "pen", style: "writer", sortOrder: 60,
    description: "社区活动派发的创作荣誉" },
  { key: "developer", name: "开发者", text: "开发者", icon: "code", style: "dev", sortOrder: 70,
    description: "社区活动派发的开发者荣誉" },
  { key: "designer", name: "设计师", text: "设计师", icon: "palette", style: "designer", sortOrder: 80,
    description: "社区活动派发的设计师荣誉" },
] as const;

export interface WornBadge {
  name: string;
  text: string;
  icon: string;
  style: string;
}

/**
 * 批量取用户佩戴中的徽章（含启用的徽章元数据），按 username 分组。
 * 佩戴数 ≤ WEAR_LIMIT 由写入端约束；此处再按创建顺序截断兜底。
 */
export async function getWornBadgesByUsernames(
  usernames: string[],
): Promise<Map<string, WornBadge[]>> {
  const map = new Map<string, WornBadge[]>();
  const unique = [...new Set(usernames.filter(Boolean))];
  if (unique.length === 0) return map;
  const rows = await db
    .select({
      username: users.username,
      name: extBadges.name,
      text: extBadges.text,
      icon: extBadges.icon,
      style: extBadges.style,
      createdAt: extBadgeWear.createdAt,
    })
    .from(extBadgeWear)
    .innerJoin(extBadges, eq(extBadges.id, extBadgeWear.badgeId))
    .innerJoin(users, eq(users.id, extBadgeWear.userId))
    .where(and(inArray(users.username, unique), eq(extBadges.enabled, true)))
    .orderBy(extBadgeWear.createdAt);
  for (const r of rows) {
    const list = map.get(r.username) ?? [];
    if (list.length >= WEAR_LIMIT) continue;
    list.push({ name: r.name, text: r.text, icon: r.icon, style: r.style });
    map.set(r.username, list);
  }
  return map;
}

/** 用户获得的全部徽章（含佩戴态），供主页/设置使用。 */
export async function getUserBadges(userId: string) {
  const granted = await db
    .select({
      id: extBadges.id,
      key: extBadges.key,
      name: extBadges.name,
      text: extBadges.text,
      icon: extBadges.icon,
      style: extBadges.style,
      description: extBadges.description,
      enabled: extBadges.enabled,
      createdAt: extBadgeGrants.createdAt,
      worn: extBadgeWear.userId,
    })
    .from(extBadgeGrants)
    .innerJoin(extBadges, eq(extBadges.id, extBadgeGrants.badgeId))
    .leftJoin(
      extBadgeWear,
      and(eq(extBadgeWear.badgeId, extBadgeGrants.badgeId), eq(extBadgeWear.userId, extBadgeGrants.userId)),
    )
    .where(eq(extBadgeGrants.userId, userId))
    .orderBy(extBadgeGrants.createdAt);
  const wornIds = new Set(granted.filter((g) => g.worn).map((g) => g.id));
  return {
    granted: granted.map((g) => ({
      id: g.id,
      key: g.key,
      name: g.name,
      text: g.text,
      icon: g.icon,
      style: g.style,
      description: g.description,
      enabled: g.enabled,
      createdAt: g.createdAt.toISOString(),
      worn: wornIds.has(g.id),
    })),
    wornIds: [...wornIds].slice(0, WEAR_LIMIT),
  };
}

/**
 * 按 key 幂等授予徽章：首次授予发站内恭喜通知，重复授予静默跳过
 * （DB 唯一约束 userId+badgeId 兜底防刷）。返回是否为「本次新授予」。
 */
export async function awardBadgeByKey(
  userId: string,
  key: string,
  note?: string,
): Promise<boolean> {
  const [badge] = await db
    .select({ id: extBadges.id, name: extBadges.name })
    .from(extBadges)
    .where(eq(extBadges.key, key))
    .limit(1);
  if (!badge) return false;
  const inserted = await db
    .insert(extBadgeGrants)
    .values({ badgeId: badge.id, userId, note: note ?? null })
    .onConflictDoNothing({ target: [extBadgeGrants.userId, extBadgeGrants.badgeId] })
    .returning({ id: extBadgeGrants.id });
  if (inserted.length > 0) {
    await notifyBadgeGranted(userId, badge.name);
    return true;
  }
  return false;
}

const plugin: Plugin = {
  name: "badges",
  description: "Community badge system",
  version: "1.0.0",
  register(ctx) {
    // 创世策略：截止时间前注册的用户自动获得「创世」徽章
    if (Date.now() < GENESIS_DEADLINE_MS) {
      ctx.events.on("user:registered", ({ userId }) => {
        if (Date.now() >= GENESIS_DEADLINE_MS) return;
        void awardBadgeByKey(userId, "genesis", "创世成员").catch(() => undefined);
      });
    }

    // 种子徽章：幂等（按 key 唯一冲突跳过），后台可再编辑/停用
    void (async () => {
      try {
        await db
          .insert(extBadges)
          .values(SEED_BADGES.map((b) => ({ ...b })))
          .onConflictDoNothing({ target: extBadges.key });
      } catch (err) {
        console.error("[badges] seed failed (non-fatal):", err);
      }
      // 创世回填：截止前注册的全部现存用户（幂等，静默授予不通知）
      if (Date.now() < GENESIS_DEADLINE_MS) {
        try {
          await db.execute(
            sql`INSERT INTO ext_badge_grants (user_id, badge_id)
                SELECT u.id, b.id FROM users u, ext_badges b
                WHERE b.key = 'genesis'
                  AND u.created_at < to_timestamp(${GENESIS_DEADLINE_MS} / 1000.0)
                  AND u.status = 'active'
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          console.error("[badges] genesis backfill failed (non-fatal):", err);
        }
      }
    })();
  },
};

export default plugin;

/** sendOperationNotification 引用占位：颁发徽章时由管理路由调用。 */
export async function notifyBadgeGranted(userId: string, badgeName: string) {
  const siteName = await getSetting("site.name").catch(() => "");
  await sendOperationNotification(userId, {
    key: "badge.granted",
    title: { zh: "恭喜获得新徽章", en: "New badge unlocked" },
    body: {
      zh: `你在${siteName || "社区"}获得了「${badgeName}」徽章，可前往个人主页佩戴展示。`,
      en: `You earned the "${badgeName}" badge. Wear it on your profile!`,
    },
    payload: { badgeName },
  });
}
