import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { mentions, users } from "@/db/schema";

/**
 * @提及系统：
 *  - processMentions：解析文本中的 @用户名/@昵称（两者均全站唯一，可无歧义
 *    解析），把命中片段**重写为稳定引用语法** `@[当前昵称](mention:{userId})`
 *    并落 mentions 记录（notifiedAt 为空 = 待通知）。昵称后续修改时，
 *    渲染端按 userId 查最新昵称 → 历史 @ 同步更新。
 *  - expandMentionTokens：渲染前把稳定引用语法展开为
 *    `[@最新昵称](/u/{username})`（站内相对链接，渲染端可 SPA 跳转）；
 *    用户已注销/不存在时降级为纯文本 `@旧昵称`。
 *  - flushMentionNotifications(targetType, targetId, url, excerpt)：
 *    内容可见时调用 —— 给未通知的被提及用户发「被 @ 提及」通知并标记。
 */

const MENTION_TOKEN = /\[@([^\]]+)\]\(mention:([0-9a-f-]{36})\)/g;
/** @候选：字母/数字/_/-/中文，1-40 位（不含空白与 @）。
 *  边界用 lookbehind：@ 前不能是英数/_/@/.（排除邮箱 a@b.com 等误伤），
 *  但允许 CJK/标点紧跟 —— 中文社区普遍「你好@昵称」无空格输入，
 *  旧边界（仅空白/括号）会把这类提及整体漏掉。 */
const MENTION_CANDIDATE = /(?<![A-Za-z0-9_@.])@([A-Za-z0-9_\-\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff.]{0,60})/g;

export interface ProcessedMentions {
  /** 重写后的文本（含稳定 mention 引用语法） */
  text: string;
  /** 去重后的被提及用户 id（含作者本人） */
  mentionedUserIds: string[];
}

export async function processMentions(
  text: string,
  authorId: string,
): Promise<ProcessedMentions> {
  const candidates = new Set<string>();
  for (const m of text.matchAll(MENTION_CANDIDATE)) {
    candidates.add(m[1]);
  }
  if (candidates.size === 0) return { text, mentionedUserIds: [] };

  const list = [...candidates];
  const resolved = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(
      and(
        inArray(sql`lower(${users.username})`, list.map((c) => c.toLowerCase())),
      ),
    );
  // 昵称精确匹配（大小写不敏感）
  const lowerList = list.map((c) => c.toLowerCase());
  const byName = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(sql`lower(${users.displayName})`, lowerList));
  for (const r of byName) resolved.push(r);

  // id 去重（含作者本人：自己 @ 自己同样落记录并发通知）
  const byId = new Map<string, (typeof resolved)[number]>();
  for (const r of resolved) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }

  if (byId.size === 0) return { text, mentionedUserIds: [] };

  // 重写：@token（用户名或昵称形态均命中）→ 稳定引用语法
  let out = text;
  for (const candidate of candidates) {
    const hit = [...byId.values()].find(
      (r) => r.username.toLowerCase() === candidate.toLowerCase() ||
        r.displayName.toLowerCase() === candidate.toLowerCase(),
    );
    if (!hit) continue;
    const tokenRe = new RegExp(`@${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    out = out.replace(
      tokenRe,
      `@[${hit.displayName}](mention:${hit.id})`,
    );
  }
  const mentionedUserIds = [...byId.keys()];
  return { text: out, mentionedUserIds };
}

/** 落 mentions 记录（内容创建/编辑时调用；编辑会先清旧记录）。 */
export async function storeMentions(
  targetType: "post" | "comment",
  targetId: string,
  authorId: string,
  mentionedUserIds: string[],
): Promise<void> {
  if (!mentionedUserIds.length) return;
  await db
    .insert(mentions)
    .values(mentionedUserIds.map((userId) => ({ userId, authorId, targetType, targetId })))
    .onConflictDoNothing();
}

export async function clearMentions(
  targetType: "post" | "comment",
  targetId: string,
): Promise<void> {
  await db
    .delete(mentions)
    .where(and(eq(mentions.targetType, targetType), eq(mentions.targetId, targetId)));
}

/** 渲染前展开：稳定引用 → `[@最新昵称](/u/{username})` 相对链接。 */
export async function expandMentionTokens(text: string): Promise<string> {
  const ids = [...text.matchAll(MENTION_TOKEN)].map((m) => m[2]);
  if (ids.length === 0) return text;
  const uniqueIds = [...new Set(ids)];
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, uniqueIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return text.replace(MENTION_TOKEN, (whole, label: string, id: string) => {
    const u = byId.get(id);
    if (!u) return `@${label}`;
    return `[@${u.displayName}](/u/${u.username})`;
  });
}

/** 内容可见时：给未通知的被提及用户发通知并标记（幂等）。 */
export async function flushMentionNotifications(
  targetType: "post" | "comment",
  targetId: string,
  opts: { url: string; excerpt: string; authorName: string },
): Promise<void> {
  const { sendOperationNotification } = await import("@/lib/operation-notify");
  const pending = await db
    .select({ id: mentions.id, userId: mentions.userId })
    .from(mentions)
    .where(
      and(
        eq(mentions.targetType, targetType),
        eq(mentions.targetId, targetId),
        isNull(mentions.notifiedAt),
      ),
    );
  for (const row of pending) {
    await sendOperationNotification(row.userId, {
      key: "mention.created",
      title: { zh: "你被 @ 提及了", en: "You were mentioned" },
      body: {
        zh: `${opts.authorName} 在内容中提到了你：${opts.excerpt}`,
        en: `${opts.authorName} mentioned you in a post: ${opts.excerpt}`,
      },
      url: opts.url,
      payload: { targetType, targetId },
    });
    await db
      .update(mentions)
      .set({ notifiedAt: new Date() })
      .where(eq(mentions.id, row.id));
  }
}
