import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, posts, users, comments } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { renderMail } from "@/lib/mail";
import { renderSystemMail, renderTemplate } from "@/lib/mail-templates";
import { sendOperationNotification } from "@/lib/operation-notify";
import { channels, registerChannel, type NotificationChannel, type NotificationMessage, type Plugin, type PluginContext } from "@/core/plugins/types";
import { routes } from "@/core/routes";
import { broadcast } from "@/core/capabilities/broadcast";
import type { Locale } from "@/lib/i18n";
import { setNotificationDispatcher } from "@/core/capabilities/jobs";

/**
 * Notifications plugin (Laravel-style multi-channel):
 *   notify.send(userId, message) → looks up the user's channel preference
 *   for that notification key and fans out to registered channels.
 * Channels: 'database' (in-site) and 'mail' (SMTP via queue); the webhooks
 * plugin registers 'webhook'. New channels can be added by any plugin.
 */

export const DEFAULT_CHANNELS = ["database", "mail"];

async function userChannels(userId: string, key: string): Promise<string[]> {
  const { users } = await import("@/db/schema");
  const [user] = await db
    .select({ prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.prefs?.[key] ?? DEFAULT_CHANNELS;
}

/** Send a notification to a user through their preferred channels. */
export async function notifySend(userId: string, message: NotificationMessage): Promise<void> {
  const emailEnabled = await getSetting("notify.emailEnabled");
  const chIds = (await userChannels(userId, message.key)).filter(
    (c) => c !== "mail" || emailEnabled,
  );
  const targets = chIds
    .map((id) => channels.get(id))
    .filter((c): c is NotificationChannel => Boolean(c));
  await Promise.all(
    targets.map(async (ch) => {
      try {
        await ch.send(userId, message);
      } catch (err) {
        console.error(`[notify] channel ${ch.id} failed:`, err);
      }
    }),
  );
}

/* ------------------------------ channels -------------------------------- */

const databaseChannel: NotificationChannel = {
  id: "database",
  label: { zh: "站内通知", en: "In-site" },
  async send(userId, message) {
    await db.insert(notifications).values({
      userId,
      key: message.key,
      title: message.title.zh,
      body: message.body?.zh ?? null,
      url: message.url ?? null,
      actorId: message.actorId ?? null,
      payload: message.payload,
    });
  },
};

const mailChannel: NotificationChannel = {
  id: "mail",
  label: { zh: "邮件", en: "Email" },
  async send(userId, message) {
    const { users } = await import("@/db/schema");
    const { queue } = await import("@/core/queue");
    const [user] = await db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return;
    const locale = (user.locale === "en" ? "en" : "zh") as Locale;
    const key = message.key;

    // Operations notices (system.* / verification.*) render through the
    // generic, admin-customizable "system" mail template.
    if (key.startsWith("system.") || key.startsWith("verification.")) {
      const reason = typeof message.payload?.reason === "string" ? message.payload.reason : undefined;
      let rendered = { subject: "", html: "", text: "" };
      try {
        rendered = renderSystemMail(locale, {
          title: locale === "zh" ? message.title.zh : message.title.en,
          body: (locale === "zh" ? message.body?.zh : message.body?.en) ?? "",
          url: message.url,
          reason,
        });
      } catch (err) {
        console.error("[notify] system mail render failed:", err);
      }
      if (!rendered.subject) {
        console.info(`[notify] mail skipped: "system" template disabled or rendered empty (key=${key})`);
        return;
      }
      await queue.send("mail.send", { to: user.email, subject: rendered.subject, text: rendered.text, html: rendered.html });
      return;
    }

    const actorName = String(message.payload?.actorName ?? "");
    const excerpt = message.body?.zh ?? message.title.zh;
    const url = message.url ?? "";
    const tpl = key.startsWith("comment.")
      ? "commentReply"
      : key.startsWith("follow.")
        ? "newFollower"
        : key.startsWith("message.")
          ? "newMessage"
          : key.startsWith("moderation.")
            ? "moderationRejected"
            : null;
    if (!tpl) return; // no email template for this notification type
    const data = {
      actor: actorName,
      post: message.title.zh,
      excerpt,
      url,
      reason: excerpt,
    };
    let subject = "";
    let text = "";
    let html = "";
    try {
      ({ subject, html, text } = renderTemplate(tpl, locale, data));
    } catch (err) {
      console.error(`[notify] template "${tpl}" render failed; falling back to builtin:`, err);
      ({ subject, html, text } = renderMail(tpl, locale, data));
    }
    if (!subject) {
      console.info(`[notify] mail skipped: template "${tpl}" disabled by override`);
      return;
    }
    await queue.send("mail.send", { to: user.email, subject, text, html });
  },
};

const plugin: Plugin = {
  name: "notifications",
  description: "Multi-channel notifications (database, mail; extensible)",
  version: "1.1.0",
  register(ctx: PluginContext) {
    registerChannel(databaseChannel);
    registerChannel(mailChannel);

    // 通电：向核心登记同步分发实现 —— ctx.notifications.send（请求路径）
    // 与 notify.dispatch 队列 worker（runNotifyDispatch）都经它扇出到渠道。
    // 不登记的话两者一律抛「通知分发器未就绪」（历史接线缺口，2026-09 审计）。
    setNotificationDispatcher(notifySend);

    // Operation events (admin/editor actions) → user notifications via
    // sendOperationNotification (database + mail channels). Failures inside
    // the helper are swallowed so events never break the primary action.
    ctx.events.on("user:banned", ({ userId, bannedUntil, reason, byAdminId }) => {
      void sendOperationNotification(userId, {
        key: "system.ban",
        title: { zh: "账号封禁通知", en: "Account suspended" },
        body: {
          zh: `原因：${reason}；${bannedUntil ? `解封时间：${new Date(bannedUntil).toLocaleString("zh-CN")}` : "此为永久封禁"}`,
          en: `Reason: ${reason}; ${bannedUntil ? `until ${new Date(bannedUntil).toLocaleString("en-US")}` : "this is a permanent ban"}`,
        },
        payload: { bannedUntil, reason, byAdminId },
      });
    });

    ctx.events.on("user:unbanned", ({ userId, byAdminId }) => {
      void sendOperationNotification(userId, {
        key: "system.unban",
        title: { zh: "封禁已解除", en: "Ban lifted" },
        body: {
          zh: "你的账号封禁已解除，所有功能已恢复，欢迎回来。",
          en: "The suspension on your account has been lifted. Welcome back.",
        },
        payload: { byAdminId },
      });
    });

    ctx.events.on("user:warned", ({ userId, message, byAdminId }) => {
      void sendOperationNotification(userId, {
        key: "system.warn",
        title: { zh: "警告通知", en: "Warning notice" },
        body: { zh: message, en: message },
        payload: { message, byAdminId },
      });
    });

    ctx.events.on("verification:approved", ({ userId, type, label }) => {
      void sendOperationNotification(userId, {
        key: "verification.approved",
        title: { zh: "认证审核通过", en: "Verification approved" },
        body: {
          zh: `恭喜！你的「${label}」认证（${type}）已通过审核。`,
          en: `Congratulations! Your "${label}" verification (${type}) has been approved.`,
        },
        payload: { type, label },
      });
    });

    ctx.events.on("verification:rejected", ({ userId, reason }) => {
      void sendOperationNotification(userId, {
        key: "verification.rejected",
        title: { zh: "认证审核未通过", en: "Verification rejected" },
        body: {
          zh: `很抱歉，你的认证申请未通过审核。原因：${reason}`,
          en: `Unfortunately your verification request was rejected. Reason: ${reason}`,
        },
        payload: { reason },
      });
    });

    // ---- 核心社交事件 → 站内通知（此前无人消费，收件人收不到评论/关注/私信提醒）。
    // 全部 best-effort：监听器内部吞错（Emittery 下 emit 方 `void emit(...)` 会把
    // rejection 变成 unhandled rejection，绝不让通知失败影响主流程）。
    ctx.events.on("comment:created", (p) => void notifyCommentCreated(p));
    ctx.events.on("user:followed", (p) => void notifyUserFollowed(p));
    ctx.events.on("message:created", (p) => void notifyMessageCreated(p));
    // 审核结果 → 通知内容作者（过审发布 / 未通过 + 原因）
    ctx.events.on("moderation:review.completed", (p) => void notifyModerationCompleted(p));
    // ---- 互动与管理处置通知（点赞 / 回复 / 解决方案 / 举报处理 / 人工审核 / 内容删除）
    ctx.events.on("post:liked", (p) => void notifyPostLiked(p));
    ctx.events.on("post:reposted", (p) => void notifyPostReposted(p));
    ctx.events.on("comment:liked", (p) => void notifyCommentLiked(p));
    ctx.events.on("comment:solved", (p) => void notifyCommentSolved(p));
    ctx.events.on("post:approved", (p) => void notifyPostApproved(p));
    ctx.events.on("post:rejected", (p) => void notifyPostRejected(p));
    ctx.events.on("comment:removed", (p) => void notifyCommentRemoved(p));
    ctx.events.on("report:resolved", (p) => void notifyReportResolved(p));
  },
};

/* ------------------- 社交事件监听器（database + mail 双通道） ------------------- */

/** 帖子被喜欢：通知帖子作者（自赞跳过）。 */
async function notifyPostLiked(p: {
  postId: string;
  actorId: string;
  authorId: string;
}): Promise<void> {
  try {
    if (p.actorId === p.authorId) return;
    const [post] = await db
      .select({ publicId: posts.publicId, title: posts.title, type: posts.type })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    if (!post) return;
    const actorName = await actorNameOf(p.actorId);
    const kindZh = post.type === "short" ? "动态" : "文章";
    const postTitle = post.title ?? `（无标题${kindZh}）`;
    await deliver(p.authorId, {
      key: "post.liked",
      title: { zh: postTitle, en: postTitle },
      body: {
        zh: `${actorName} 喜欢了你的${kindZh}`,
        en: `${actorName} liked your ${post.type === "short" ? "post" : "article"}`,
      },
      url: routes.post(post.publicId),
      actorId: p.actorId,
      payload: { postId: p.postId, actorName },
    });
  } catch (err) {
    console.error("[notify] post:liked listener failed:", err);
  }
}

/** 帖子被转发：通知帖子作者（自转跳过）。 */
async function notifyPostReposted(p: {
  postId: string;
  actorId: string;
  authorId: string;
}): Promise<void> {
  try {
    if (p.actorId === p.authorId) return;
    const [post] = await db
      .select({ publicId: posts.publicId, title: posts.title, type: posts.type })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    if (!post) return;
    const actorName = await actorNameOf(p.actorId);
    const kindZh = post.type === "short" ? "动态" : "文章";
    const postTitle = post.title ?? `（无标题${kindZh}）`;
    await deliver(p.authorId, {
      key: "post.reposted",
      title: { zh: postTitle, en: postTitle },
      body: {
        zh: `${actorName} 转发了你的${kindZh}`,
        en: `${actorName} reposted your ${post.type === "short" ? "post" : "article"}`,
      },
      url: routes.post(post.publicId),
      actorId: p.actorId,
      payload: { postId: p.postId, actorName },
    });
  } catch (err) {
    console.error("[notify] post:reposted listener failed:", err);
  }
}

/** 评论被喜欢：通知评论作者（自赞跳过），链接直达楼层。 */
async function notifyCommentLiked(p: {
  commentId: string;
  actorId: string;
  commentAuthorId: string;
}): Promise<void> {
  try {
    if (p.actorId === p.commentAuthorId) return;
    const [row] = await db
      .select({ publicId: posts.publicId, body: comments.body })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.id, p.commentId))
      .limit(1);
    if (!row) return;
    const actorName = await actorNameOf(p.actorId);
    await deliver(p.commentAuthorId, {
      key: "comment.liked",
      title: { zh: "你的评论收到喜欢", en: "Your comment received a like" },
      body: {
        zh: `${actorName} 喜欢了你的评论：${truncateText(row.body, 80)}`,
        en: `${actorName} liked your comment: ${truncateText(row.body, 80)}`,
      },
      url: `${routes.post(row.publicId)}#comment-${p.commentId}`,
      actorId: p.actorId,
      payload: { commentId: p.commentId, actorName },
    });
  } catch (err) {
    console.error("[notify] comment:liked listener failed:", err);
  }
}

/** 评论被帖子作者标记为解决方案：通知评论作者。 */
async function notifyCommentSolved(p: {
  commentId: string;
  postId: string;
  commentAuthorId: string;
  postAuthorId: string;
}): Promise<void> {
  try {
    if (p.commentAuthorId === p.postAuthorId) return; // 自己标记自己（主帖自评解）
    const [row] = await db
      .select({ publicId: posts.publicId, body: comments.body })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.id, p.commentId))
      .limit(1);
    if (!row) return;
    const actorName = await actorNameOf(p.postAuthorId);
    await deliver(p.commentAuthorId, {
      key: "comment.solved",
      title: { zh: "你的评论被标记为解决方案", en: "Your comment was marked as the solution" },
      body: {
        zh: `${actorName} 将你的评论标记为解决方案：${truncateText(row.body, 80)}`,
        en: `${actorName} marked your comment as the solution: ${truncateText(row.body, 80)}`,
      },
      url: `${routes.post(row.publicId)}#comment-${p.commentId}`,
      actorId: p.postAuthorId,
      payload: { commentId: p.commentId, postId: p.postId, actorName },
    });
  } catch (err) {
    console.error("[notify] comment:solved listener failed:", err);
  }
}

/** 人工过审（管理端 approve）：通知作者已发布。 */
async function notifyPostApproved(p: { postId: string; authorId: string; moderatorId?: string }): Promise<void> {
  try {
    const [post] = await db
      .select({ publicId: posts.publicId, title: posts.title })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    if (!post) return;
    await deliver(p.authorId, {
      key: "moderation.approved",
      title: { zh: "审核通过", en: "Approved" },
      body: {
        zh: `你的内容「${post.title ?? "（无标题）"}」已通过人工审核并发布。`,
        en: `"${post.title ?? "Untitled"}" has passed manual review and is now published.`,
      },
      url: routes.post(post.publicId),
      payload: { postId: p.postId, approved: true },
    });
  } catch (err) {
    console.error("[notify] post:approved listener failed:", err);
  }
}

/** 内容被驳回（人工驳回 / 举报处置）：通知作者并附原因。 */
async function notifyPostRejected(p: {
  postId: string;
  authorId: string;
  reason: string;
  moderatorId?: string;
}): Promise<void> {
  try {
    const [post] = await db
      .select({ publicId: posts.publicId, title: posts.title })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    const postTitle = post?.title ?? "";
    await deliver(p.authorId, {
      key: "moderation.rejected",
      title: { zh: "内容未通过审核", en: "Content rejected" },
      body: {
        zh: `你的内容${postTitle ? `「${postTitle}」` : ""}未通过审核。原因：${p.reason}`,
        en: `Your content${postTitle ? ` "${postTitle}"` : ""} was rejected. Reason: ${p.reason}`,
      },
      // 软驳回（rejected）作者仍可查看详情与原因；物理删除时无链接
      url: post ? routes.post(post.publicId) : undefined,
      payload: { postId: p.postId, approved: false, reason: p.reason },
    });
  } catch (err) {
    console.error("[notify] post:rejected listener failed:", err);
  }
}

/** 评论被删除（举报处置 / 管理员删除）：通知评论作者。 */
async function notifyCommentRemoved(p: {
  commentId: string;
  postId: string;
  authorId: string;
  reason?: string;
  by: "report" | "admin";
}): Promise<void> {
  try {
    const [post] = await db
      .select({ publicId: posts.publicId, title: posts.title })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    const postTitle = post?.title ?? "";
    const byZh = p.by === "report" ? "经举报核实" : "被管理员";
    await deliver(p.authorId, {
      key: "comment.removed",
      title: { zh: "评论已被移除", en: "Comment removed" },
      body: {
        zh: `你在${postTitle ? `「${postTitle}」` : "某篇内容"}下的评论${byZh}删除。${p.reason ? `原因：${p.reason}` : ""}`,
        en: `Your comment${postTitle ? ` on "${postTitle}"` : ""} was removed ${p.by === "report" ? "after a report" : "by a moderator"}.${p.reason ? ` Reason: ${p.reason}` : ""}`,
      },
      url: post ? routes.post(post.publicId) : undefined,
      payload: { commentId: p.commentId, postId: p.postId, by: p.by, reason: p.reason ?? null },
    });
  } catch (err) {
    console.error("[notify] comment:removed listener failed:", err);
  }
}

/** 举报处理完毕：通知举报人结果（已处置 / 已忽略），附实际动作。 */
async function notifyReportResolved(p: {
  reportId: string;
  reporterId: string;
  outcome: "resolved" | "dismissed";
  action?: string;
  targetType?: string;
  reason?: string;
}): Promise<void> {
  try {
    const actionZh: Record<string, string> = {
      resolve: "已处理完成",
      dismiss: "未发现违规",
      delete_content: "相关内容已被移除",
      ban_author: "相关账号已被处置",
      warn_author: "已向相关作者发出警告",
    };
    const targetZh = p.targetType === "post" ? "内容" : p.targetType === "comment" ? "评论" : "用户";
    const summary = actionZh[p.action ?? ""] ?? "已处理";
    await deliver(p.reporterId, {
      key: "report.resolved",
      title: { zh: p.outcome === "resolved" ? "举报已处理" : "举报已关闭", en: p.outcome === "resolved" ? "Report handled" : "Report dismissed" },
      body: {
        zh:
          p.outcome === "resolved"
            ? `你举报的${targetZh}：${summary}。感谢你的反馈，帮助我们维护社区环境。`
            : `你举报的${targetZh}经核实未发现违规，该举报已关闭。`,
        en:
          p.outcome === "resolved"
            ? `Your ${p.targetType ?? "content"} report: ${summary}. Thanks for helping keep the community safe.`
            : `Your report was reviewed and no violation was found; it has been closed.`,
      },
      payload: { reportId: p.reportId, outcome: p.outcome, action: p.action ?? null },
    });
  } catch (err) {
    console.error("[notify] report:resolved listener failed:", err);
  }
}

/** 通知正文截断（纯文本，无 markdown 处理，够用即可）。 */
function truncateText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 审核结果通知：帖子→帖子作者；评论→评论作者（非帖子作者）。 */
async function notifyModerationCompleted(p: {
  postId: string;
  commentId?: string;
  approved: boolean;
  by: "keyword" | "llm" | "manual";
  reason?: string;
}): Promise<void> {
  try {
    const [post] = await db
      .select({ authorId: posts.authorId, publicId: posts.publicId, title: posts.title, type: posts.type })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    if (!post) return;
    // 评论审核：收件人是评论作者（帖子仅在链接/标题上出现）
    let recipientId = post.authorId;
    if (p.commentId) {
      const [comment] = await db
        .select({ userId: comments.userId })
        .from(comments)
        .where(eq(comments.id, p.commentId))
        .limit(1);
      if (!comment) return;
      recipientId = comment.userId;
    }
    const kindZh = p.commentId ? "评论" : post.type === "short" ? "动态" : "文章";
    const postTitle = post.title ?? `（无标题${kindZh}）`;
    const url = p.commentId
      ? `${routes.post(post.publicId)}#comment-${p.commentId}`
      : routes.post(post.publicId);
    await deliver(recipientId, {
      key: p.approved ? "moderation.approved" : "moderation.rejected",
      title: { zh: p.approved ? "审核通过" : "审核未通过", en: p.approved ? "Approved" : "Rejected" },
      body: p.approved
        ? {
            zh: `你的${kindZh}「${postTitle}」已通过审核并发布。`,
            en: `Your ${kindZh} "${postTitle}" has passed review and is now published.`,
          }
        : {
            zh: `你的${kindZh}「${postTitle}」未通过审核。原因：${p.reason ?? "未提供"}`,
            en: `Your ${kindZh} "${postTitle}" was rejected. Reason: ${p.reason ?? "unspecified"}`,
          },
      url,
      payload: { postId: p.postId, commentId: p.commentId ?? null, approved: p.approved, reason: p.reason ?? null },
    });
  } catch (err) {
    console.error("[notify] moderation:review.completed listener failed:", err);
  }
}

/**
 * 落库 + SSE 实时广播（broadcast 同步、进程内 pub/sub；客户端收到
 * notification.created 后失效未读/通知查询）。失败只记日志。
 */
async function deliver(userId: string, message: NotificationMessage): Promise<void> {
  try {
    await notifySend(userId, message);
    broadcast([userId], { type: "notification.created" });
  } catch (err) {
    console.error(`[notify] social "${message.key}" → ${userId} failed:`, err);
  }
}

/** 动作者展示名（displayName 优先，username 兜底；查不到返回空串）。 */
async function actorNameOf(userId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ? row.displayName || row.username : "";
  } catch (err) {
    console.error("[notify] actor lookup failed:", err);
    return "";
  }
}

async function notifyCommentCreated(p: {
  commentId: string;
  postId: string;
  postAuthorId: string;
  commenterId: string;
  replyToUserId?: string | null;
  excerpt: string;
}): Promise<void> {
  try {
    const [post] = await db
      .select({ publicId: posts.publicId, title: posts.title, type: posts.type })
      .from(posts)
      .where(eq(posts.id, p.postId))
      .limit(1);
    if (!post) return; // 帖子已被删除
    const actorName = await actorNameOf(p.commenterId);
    const base = routes.post(post.publicId);
    const kindZh = post.type === "short" ? "动态" : "文章";
    const postTitle = post.title ?? `（无标题${kindZh}）`; // 短动态可无 title

    // 1) 通知帖子作者（自己文章自己评论跳过）
    if (p.postAuthorId !== p.commenterId) {
      await deliver(p.postAuthorId, {
        key: "comment.created", // mail: comment.* → commentReply 模板（payload.actorName）
        title: { zh: postTitle, en: postTitle },
        body: {
          zh: `${actorName} 评论了你的${kindZh}：${p.excerpt}`,
          en: `${actorName} commented on your post: ${p.excerpt}`,
        },
        url: `${base}#comment-${p.commentId}`, // 锚点与 components/social/comments.tsx 一致
        actorId: p.commenterId,
        payload: { commentId: p.commentId, postId: p.postId, actorName, excerpt: p.excerpt },
      });
    }

    // 2) 通知被回复的评论作者（「回复我」；与帖子作者是同一人时上面已通知，跳过）
    const replyTo = p.replyToUserId ?? null;
    if (replyTo && replyTo !== p.commenterId && replyTo !== p.postAuthorId) {
      await deliver(replyTo, {
        key: "comment.reply",
        title: { zh: `${actorName} 回复了你`, en: `${actorName} replied to you` },
        body: {
          zh: `你在「${postTitle}」的评论收到了回复：${p.excerpt}`,
          en: `Your comment on "${postTitle}" received a reply: ${p.excerpt}`,
        },
        url: `${base}#comment-${p.commentId}`,
        actorId: p.commenterId,
        payload: { commentId: p.commentId, postId: p.postId, actorName, excerpt: p.excerpt },
      });
    }
  } catch (err) {
    console.error("[notify] comment:created listener failed:", err);
  }
}

async function notifyUserFollowed(p: { followerId: string; followeeId: string }): Promise<void> {
  try {
    if (p.followerId === p.followeeId) return; // 防御：自关注理论上不可能
    const [actor] = await db
      .select({ username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, p.followerId))
      .limit(1);
    if (!actor) return; // 关注者已被删除
    const actorName = actor.displayName || actor.username;
    await deliver(p.followeeId, {
      key: "follow.created", // mail: follow.* → newFollower 模板
      title: { zh: "你有新的关注者", en: "You have a new follower" },
      body: { zh: `${actorName} 关注了你`, en: `${actorName} started following you` },
      url: routes.profile(actor.username),
      actorId: p.followerId,
      payload: { followerId: p.followerId, actorName },
    });
  } catch (err) {
    console.error("[notify] user:followed listener failed:", err);
  }
}

async function notifyMessageCreated(p: {
  messageId: string;
  senderId: string;
  receiverId: string;
  excerpt: string;
}): Promise<void> {
  try {
    if (p.senderId === p.receiverId) return; // 防御：自发消息不打扰
    const actorName = await actorNameOf(p.senderId);
    await deliver(p.receiverId, {
      key: "message.created", // mail: message.* → newMessage 模板
      title: { zh: "你有新的私信", en: "You have a new message" },
      body: { zh: `${actorName}：${p.excerpt}`, en: `${actorName}: ${p.excerpt}` },
      url: routes.conversation(p.senderId),
      actorId: p.senderId,
      payload: { messageId: p.messageId, senderId: p.senderId, actorName },
    });
  } catch (err) {
    console.error("[notify] message:created listener failed:", err);
  }
}

export default plugin;
