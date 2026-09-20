import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  comments,
  extBadgeGrants,
  extBadges,
  extBadgeWear,
  invites,
  likes,
  posts,
  reports,
  users,
} from "@/db/schema";
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
  { key: "l-lao", name: "LD大佬", text: "LD大佬", icon: "zap", style: "dev", sortOrder: 45,
    description: "通过 Linux.do SSO 接入社区的成员" },
  { key: "cute", name: "小可爱", text: "小可爱", icon: "heart", style: "cute", sortOrder: 50,
    description: "社区活动派发的荣誉头衔" },
  { key: "writer", name: "大作家", text: "大作家", icon: "pen", style: "writer", sortOrder: 60,
    description: "社区活动派发的创作荣誉" },
  { key: "developer", name: "开发者", text: "开发者", icon: "code", style: "dev", sortOrder: 70,
    description: "社区活动派发的开发者荣誉" },
  { key: "designer", name: "设计师", text: "设计师", icon: "palette", style: "designer", sortOrder: 80,
    description: "社区活动派发的设计师荣誉" },

  // —— 运营成就线：创作 / 互动 / 社区建设里程碑（事件驱动自动授予，幂等）——
  { key: "first-post", name: "初试啼声", text: "初啼", icon: "rocket", style: "writer", sortOrder: 90,
    description: "发布第一篇内容" },
  { key: "ten-posts", name: "笔耕不辍", text: "笔耕", icon: "pen", style: "writer", sortOrder: 91,
    description: "累计发布 10 篇内容" },
  { key: "fifty-posts", name: "著作等身", text: "著等", icon: "book", style: "writer", sortOrder: 92,
    description: "累计发布 50 篇内容" },
  { key: "first-comment", name: "破冰之声", text: "破冰", icon: "star", style: "slate", sortOrder: 93,
    description: "发表第一条评论" },
  { key: "fifty-comments", name: "谈笑风生", text: "风生", icon: "users", style: "slate", sortOrder: 94,
    description: "累计发表 50 条评论" },
  { key: "hundred-likes", name: "人气满堂", text: "人气", icon: "heart", style: "cute", sortOrder: 95,
    description: "内容累计获得 100 次点赞" },
  { key: "solved", name: "金牌解答", text: "解答", icon: "award", style: "dev", sortOrder: 96,
    description: "评论被帖子作者标记为解决方案" },
  { key: "first-invite", name: "引路人", text: "引路", icon: "medal", style: "official", sortOrder: 97,
    description: "通过邀请码成功邀请 1 位新成员" },
  { key: "ten-invites", name: "社区大使", text: "大使", icon: "users", style: "ops", sortOrder: 98,
    description: "通过邀请码成功邀请 10 位新成员" },
  { key: "first-report", name: "风纪委员", text: "风纪", icon: "flag", style: "ops", sortOrder: 99,
    description: "提交第一次社区举报，协助维护社区秩序" },
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
  opts?: { notify?: boolean },
): Promise<boolean> {
  const [badge] = await db
    .select({ id: extBadges.id, name: extBadges.name })
    .from(extBadges)
    .where(and(eq(extBadges.key, key), eq(extBadges.enabled, true)))
    .limit(1);
  if (!badge) return false;
  const inserted = await db
    .insert(extBadgeGrants)
    .values({ badgeId: badge.id, userId, note: note ?? null })
    .onConflictDoNothing({ target: [extBadgeGrants.userId, extBadgeGrants.badgeId] })
    .returning({ id: extBadgeGrants.id });
  if (inserted.length > 0) {
    // notify=false 仅用于启动回填等批量场景（静默授予，避免全量打扰）
    if (opts?.notify !== false) await notifyBadgeGranted(userId, badge.name);
    return true;
  }
  return false;
}

/* ---------------------- 运营成就线（里程碑自动授予） ---------------------- */

interface BadgeCounters {
  /** 已发布内容（文章 + 短动态） */
  posts: number;
  /** 可见评论 */
  comments: number;
  /** 内容累计获赞（帖子 + 评论） */
  likesReceived: number;
  /** 邀请码成功注册人数 */
  invites: number;
  /** 提交举报次数 */
  reports: number;
}

/** 里程碑清单：全部幂等授予，达到阈值即补齐 */
const MILESTONE_BADGES: { key: string; note: string; reached: (c: BadgeCounters) => boolean }[] = [
  { key: "first-post", note: "发布第一篇内容", reached: (c) => c.posts >= 1 },
  { key: "ten-posts", note: "累计发布 10 篇内容", reached: (c) => c.posts >= 10 },
  { key: "fifty-posts", note: "累计发布 50 篇内容", reached: (c) => c.posts >= 50 },
  { key: "first-comment", note: "发表第一条评论", reached: (c) => c.comments >= 1 },
  { key: "fifty-comments", note: "累计发表 50 条评论", reached: (c) => c.comments >= 50 },
  { key: "hundred-likes", note: "内容累计获得 100 次点赞", reached: (c) => c.likesReceived >= 100 },
  { key: "first-invite", note: "成功邀请 1 位新成员", reached: (c) => c.invites >= 1 },
  { key: "ten-invites", note: "成功邀请 10 位新成员", reached: (c) => c.invites >= 10 },
  { key: "first-report", note: "提交第一次社区举报", reached: (c) => c.reports >= 1 },
];

/**
 * 评估并补齐用户的运营成就徽章（幂等；新授予且 notify!==false 时发恭喜通知）。
 * 事件驱动调用：发文/评论/举报/邀请注册/登录完成等节点触发。
 */
export async function evaluateUserBadges(
  userId: string,
  opts?: { notify?: boolean },
): Promise<string[]> {
  const [[pc], [cc], [pl], [cl], [iv], [rp]] = await Promise.all([
    db
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.authorId, userId), eq(posts.status, "published"))),
    db
      .select({ n: count() })
      .from(comments)
      .where(and(eq(comments.userId, userId), eq(comments.status, "visible"))),
    db
      .select({ n: count() })
      .from(likes)
      .innerJoin(posts, and(eq(likes.targetId, posts.id), eq(likes.targetType, "post")))
      .where(eq(posts.authorId, userId)),
    db
      .select({ n: count() })
      .from(likes)
      .innerJoin(comments, and(eq(likes.targetId, comments.id), eq(likes.targetType, "comment")))
      .where(eq(comments.userId, userId)),
    db
      .select({ n: count() })
      .from(invites)
      .where(and(eq(invites.createdBy, userId), isNotNull(invites.usedAt))),
    db.select({ n: count() }).from(reports).where(eq(reports.reporterId, userId)),
  ]);
  const counters: BadgeCounters = {
    posts: Number(pc?.n ?? 0),
    comments: Number(cc?.n ?? 0),
    likesReceived: Number(pl?.n ?? 0) + Number(cl?.n ?? 0),
    invites: Number(iv?.n ?? 0),
    reports: Number(rp?.n ?? 0),
  };

  const newly: string[] = [];
  for (const m of MILESTONE_BADGES) {
    if (!m.reached(counters)) continue;
    const granted = await awardBadgeByKey(userId, m.key, m.note, opts).catch(() => false);
    if (granted) newly.push(m.key);
  }
  return newly;
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

    // 运营成就线：内容/互动/社区建设里程碑（事件驱动，幂等授予）
    ctx.events.on("post:published", (p) => {
      void evaluateUserBadges(p.authorId).catch((err) =>
        console.error("[badges] post milestone failed:", err),
      );
    });
    ctx.events.on("comment:created", (p) => {
      void evaluateUserBadges(p.commenterId).catch((err) =>
        console.error("[badges] comment milestone failed:", err),
      );
    });
    // 学术问答氛围：评论被作者标记为解决方案 → 评估（solved 徽章 + 获赞累计）
    ctx.events.on("comment:solved", (p) => {
      void evaluateUserBadges(p.commentAuthorId).catch((err) =>
        console.error("[badges] solved milestone failed:", err),
      );
    });
    // 社区建设：举报（风纪委员）与邀请（引路人/社区大使）
    ctx.events.on("report:submitted", (p) => {
      void evaluateUserBadges(p.reporterId).catch((err) =>
        console.error("[badges] report milestone failed:", err),
      );
    });
    ctx.events.on("user:registered", (p) => {
      // 被邀请人注册成功 → 给邀请人补算引路/大使里程碑
      if (p.invitedByUserId) {
        void evaluateUserBadges(p.invitedByUserId).catch((err) =>
          console.error("[badges] invite milestone failed:", err),
        );
      }
    });
    // 登录兜底评估：兜住资料完善、历史行为补算等一切未被事件覆盖的推进
    ctx.events.on("auth:login", (p) => {
      void evaluateUserBadges(p.userId).catch((err) =>
        console.error("[badges] login milestone failed:", err),
      );
    });

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
      // 创世回填：截止前注册的全部现存用户（幂等；新授予发恭喜通知）
      if (Date.now() < GENESIS_DEADLINE_MS) {
        try {
          const members = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.status, "active"), sql`created_at < to_timestamp(${GENESIS_DEADLINE_MS} / 1000.0)`));
          for (const m of members) {
            await awardBadgeByKey(m.id, "genesis", "创世成员");
          }
        } catch (err) {
          console.error("[badges] genesis backfill failed (non-fatal):", err);
        }
      }
      // 里程碑回填：为全部在册用户补算历史成就（新授予的逐一发恭喜通知；
      // 幂等 —— 已授予过的用户不会重复通知）
      try {
        const rows = await db.select({ id: users.id }).from(users).where(eq(users.status, "active"));
        for (const u of rows) {
          await evaluateUserBadges(u.id);
        }
      } catch (err) {
        console.error("[badges] milestone backfill failed (non-fatal):", err);
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
