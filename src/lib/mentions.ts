import "server-only";
import { and, eq, inArray, isNull, notExists, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { blocks, mentions, users } from "@/db/schema";
import { mentionSyntaxToPlainText, mentionTokenRe } from "@/lib/mention-syntax";

/**
 * @提及系统：
 *  - processMentions：解析文本中的 @用户名/@昵称（两者均全站唯一，可无歧义
 *    解析），把命中片段**重写为稳定引用语法** `@[当前昵称](mention:{userId})`
 *    并落 mentions 记录（notifiedAt 为空 = 待通知）。昵称后续修改时，
 *    渲染端按 userId 查最新昵称 → 历史 @ 同步更新。
 *  - expandMentionTokens：渲染前把稳定引用语法展开为
 *    `[@最新昵称](/u/{username})`（站内相对链接，渲染端可 SPA 跳转）；
 *    用户已注销/不存在时降级为纯文本 `@旧昵称`。
 *  - mentionTokensToPlainText：无 markdown 渲染器的出口（通知/邮件/后台表格/
 *    MCP/审核模型输入）用的纯文本形态 `@最新昵称`。
 *  - flattenMentionTokens：编辑器预填用的反向形态（`@用户名`），见其注释。
 *  - flushMentionNotifications(targetType, targetId, url, excerpt)：
 *    内容可见时调用 —— 给未通知的被提及用户发「被 @ 提及」通知并标记。
 *
 *  引用语法与各消费形态的正则都在 @/lib/mention-syntax 定义一次：生产端与消费端
 *  各写一份是历史上 @ 语法漏显的根因，见该文件注释。
 */

// 形态必须是 `@[昵称](mention:id)`（@ 在方括号外，processMentions 的重写与编辑器
// 插入均为此形态）；消费端正则与本模块同源（mentionTokenRe），故永不漂移。
const MENTION_TOKEN = mentionTokenRe();
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

/**
 * 大小写折叠的唯一裁定口径：NFC 归一后交给 JS toLowerCase。
 *
 * WHY：PG 的 lower() 与 JS 的 toLowerCase 是两套折叠规则（Σ/ς 的最终 sigma、
 * 带点的 İ、以及依赖库 locale 的映射都会分歧）。若由 SQL 的匹配结果决定「谁被
 * @ 了」，就会出现「库里算命中、正文里没被重写成链接」的分裂状态 —— 被提及者
 * 收到一条指向不存在链接的通知，等于一条可被刻意构造的骚扰通道。故 SQL 只当
 * 预筛，最终命中必须由本函数折叠后的 JS 比较裁定。
 */
function foldKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
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

  const folded = [...new Set([...candidates].map(foldKey))];
  // 用户名受 USERNAME_RE 约束（纯小写 ASCII），所以「JS 折叠后的候选 = 列值」
  // 就是精确匹配：连 lower() 都不必下推，SQL 与 JS 之间不存在折叠分歧。
  const byUsername = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(users.username, folded));
  // 昵称是自由文本，只能下推 lower() 预筛；命中与否仍由下面的 JS 比较决定。
  // 预筛同时带上原始候选，避免「JS 折叠命中、PG lower() 不命中」被漏掉。
  const byDisplayName = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(sql`lower(${users.displayName})`, [...new Set([...folded, ...candidates])]));

  const lookup = [...byUsername, ...byDisplayName].filter(
    (r, i, all) => all.findIndex((x) => x.id === r.id) === i,
  );

  // 重写：@token（用户名或昵称形态均命中）→ 稳定引用语法。
  // mentionedUserIds 从**真正被重写的**结果里收集，而不是从 SQL 命中集里收集：
  // 这保证「发了通知」与「正文里有链接」永远同源。
  let out = text;
  const mentionedUserIds: string[] = [];
  for (const candidate of candidates) {
    const key = foldKey(candidate);
    const hit = lookup.find(
      (r) => foldKey(r.username) === key || foldKey(r.displayName) === key,
    );
    if (!hit) continue;
    if (!mentionedUserIds.includes(hit.id)) mentionedUserIds.push(hit.id);
    const tokenRe = new RegExp(`@${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    out = out.replace(tokenRe, `@[${hit.displayName}](mention:${hit.id})`);
  }
  return { text: out, mentionedUserIds };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 重建某目标的提及记录（内容创建/编辑时调用）。
 *
 * 删+写必须同事务：分开执行时中途失败会静默丢掉全部记录（被 @ 的人永久收不到
 * 通知，且无任何报错线索）。`onConflictDoNothing` 依赖 `mentions_user_target_key`
 * 唯一索引兜住并发/重试的重复行。
 *
 * 删除只针对「本次不再提及」的用户，而非整表清空：若先删后插，同一批人已通知
 * 的记录会被重建为 notified_at 为空的待通知态，作者每次编辑并重新发布都会给
 * 同一批人再推一次提及通知（改一次 @ 一次，可无限刷）。保留旧行的 notified_at
 * 使重建天然幂等。
 */
export async function rebuildMentions(
  tx: Tx,
  targetType: "post" | "comment",
  targetId: string,
  authorId: string,
  mentionedUserIds: string[],
): Promise<void> {
  const scope = and(eq(mentions.targetType, targetType), eq(mentions.targetId, targetId));
  await tx
    .delete(mentions)
    .where(
      mentionedUserIds.length
        ? and(scope, notInArray(mentions.userId, mentionedUserIds))
        : scope,
    );
  if (mentionedUserIds.length === 0) return;
  await tx
    .insert(mentions)
    .values(
      mentionedUserIds.map((userId) => ({
        userId,
        authorId,
        targetType,
        targetId,
      })),
    )
    .onConflictDoNothing();
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
 * 纯文本出口（通知/邮件/后台表格/MCP/审核模型输入）：先按 userId 展成最新昵称，
 * 再拉平为可读 `@昵称` —— 这些位置没有 markdown 渲染器，漏出 `@[x](mention:id)`
 * 或 `[@x](/u/y)` 语法就是用户看到的乱码。先展后拉，昵称才是当下的。
 */
export async function mentionTokensToPlainText(text: string): Promise<string> {
  return mentionSyntaxToPlainText(await expandMentionTokens(text));
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

/**
 * 内容可见时：给未通知的被提及用户发「被 @ 提及」通知。
 *
 * 先原子认领再发送：`UPDATE … WHERE notified_at IS NULL RETURNING` 用单语句完成
 * 「取未通知集合并同时置位」。此前是先 select 再逐条 send+update，两个并发 flush
 * （post:published 被重投、发布与过审事件竞态）会同时看到 notified_at 为空，
 * 向同一用户重复推送同一条提及通知。
 *
 * 认领语义因此是 at-most-once：置位后发送失败不再重试。这么选是权衡结果——
 * 重复打扰用户比偶发丢一条通知更糟，且发送异常在此记日志而非静默。
 */
export async function flushMentionNotifications(
  targetType: "post" | "comment",
  targetId: string,
  opts: { url: string; excerpt: string; authorName: string },
): Promise<void> {
  const { sendOperationNotification } = await import("@/lib/operation-notify");
  // 拉黑关系双向排除：被提及人把作者拉黑了（或反之）时不该收到「你被 @ 了」。
  // 这里只跳过发送、不置 notifiedAt —— 记录留作待通知，日后解除拉黑仍会补上，
  // 而写入端（rebuildMentions）无法预判未来的拉黑关系。
  const blocked = notExists(
    db
      .select({ x: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, mentions.userId), eq(blocks.blockedId, mentions.authorId)),
          and(eq(blocks.blockerId, mentions.authorId), eq(blocks.blockedId, mentions.userId)),
        ),
      ),
  );
  const claimed = await db
    .update(mentions)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(mentions.targetType, targetType),
        eq(mentions.targetId, targetId),
        isNull(mentions.notifiedAt),
        blocked,
      ),
    )
    .returning({ id: mentions.id, userId: mentions.userId });
  for (const row of claimed) {
    try {
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
    } catch (err) {
      console.error("[mention] notify failed:", err);
    }
  }
}
