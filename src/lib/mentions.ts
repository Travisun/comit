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
 *  - flattenMentionTokens：编辑器预填用的反向形态（`@用户名`），见其注释。
 *  - flushMentionNotifications(targetType, targetId, url, excerpt)：
 *    内容可见时调用 —— 给未通知的被提及用户发「被 @ 提及」通知并标记。
 */

// 注意形态：是 `@[昵称](mention:id)`（@ 在方括号外，processMentions 的重写与
// 编辑器插入均为此形态），旧写法 \[@…\] 与生产者不匹配，token 永远展不开、
// UI 直显原始引用语法。
// 昵称无字符集校验（z.string()），可能自带 `]` → 标签用「有界惰性」而非
// [^\]]+：惰性向后长到第一个真实的 `](mention:<uuid>)` 收尾，既容得下 `]`
// 又不会跨多个 token 过度吞并；上界 200（昵称实际 ≤80）把回溯代价锁成线性，
// 否则 `@[` + 超长无收尾文本会是 O(n²) 的 ReDoS 面。
const MENTION_TOKEN = /@\[([\s\S]{1,200}?)\]\(mention:([0-9a-f-]{36})\)/g;
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
  // 作者本人不再被排除（自己 @ 自己也落记录并发通知）—— 参数保留以兼容既有调用点
  _authorId: string,
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

/** 引用文本里出现的用户（无 token 时返回 null ⇒ 调用方原样返回）。 */
async function resolveMentionedUsers(text: string) {
  const ids = [...text.matchAll(MENTION_TOKEN)].map((m) => m[2]);
  if (ids.length === 0) return null;
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

/** 渲染前展开：稳定引用 → `[@最新昵称](/u/{username})` 相对链接。 */
export async function expandMentionTokens(text: string): Promise<string> {
  const byId = await resolveMentionedUsers(text);
  if (!byId) return text;
  return text.replace(MENTION_TOKEN, (whole, label: string, id: string) => {
    const u = byId.get(id);
    if (!u) return `@${label}`;
    // 昵称含方括号时 markdown 链接语法无法表达（渲染端 [^\]]+ 同样会截断），
    // 降级为纯文本 @昵称 —— 宁可不链接，也不能漏出原始语法
    if (/[[\]]/.test(u.displayName)) return `@${u.displayName}`;
    return `[@${u.displayName}](/u/${u.username})`;
  });
}

/**
 * 编辑器预填：稳定引用 → 纯文本 `@{username}`（作者书写形态）。
 * 回写键必须是 username 而非昵称：昵称可能已被改、且可含空格等候选字符集外
 * 的字（MENTION_CANDIDATE 认不出 ⇒ 保存后提及静默丢失）；用户名全站唯一且
 * 字符集受控，保存时必然重新命中并按当下昵称落回稳定引用。
 */
export async function flattenMentionTokens(text: string): Promise<string> {
  const byId = await resolveMentionedUsers(text);
  if (!byId) return text;
  return text.replace(MENTION_TOKEN, (whole, label: string, id: string) => {
    const u = byId.get(id);
    return `@${u ? u.username : label}`;
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
