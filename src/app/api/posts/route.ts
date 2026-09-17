import { z } from "zod";
import { db } from "@/db";
import { polls, posts, type Post } from "@/db/schema";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { AppError, conflict } from "@/core/errors";
import { routes } from "@/core/routes";
import { emit } from "@/core/events";
import { queue } from "@/core/queue";
import { preSubmitCheck } from "@/lib/moderation";
import { runPostSaved, runPostSaving } from "@/core/capabilities/post-lifecycle";
import { DEFAULT_LABEL } from "@/lib/content-labels";
import {
  POLL_MAX_DURATION_DAYS,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  validatePollOptionsForMode,
} from "@/lib/poll";
import { newPublicId } from "@/lib/public-id";
import {
  assertCollectionOwned,
  blockedResponse,
  ensureSummary,
  labelFieldsSchema,
  parseWith,
  resolveLabelFields,
  SHORT_CONTENT_MAX,
  syncPostTopics,
  topicNamesSchema,
} from "./_shared";

/**
 * POST /api/posts — create an article or a short post.
 * body: { type, title?, content, summary?, collectionId?,
 *         topicNames?(≤5), visibility?, coverPath?, mediaPaths?(short images),
 *         label?, sourceUrl?, sourceName?, action: 'draft'|'submit' }
 * → 200 post | 422 { error, blocked } when the hard keyword check fails.
 */
const createSchema = z
  .object({
    type: z.enum(["article", "short"]),
    title: z.string().trim().max(200).optional(),
    content: z.string().max(200_000).default(""),
    summary: z.string().trim().max(500).optional(),
    collectionId: z.uuid().nullish(),
    topicNames: topicNamesSchema,
    visibility: z.enum(["public", "followers"]).optional(),
    coverPath: z.string().trim().min(1).max(500).nullish(),
    mediaPaths: z.array(z.string().trim().min(1).max(500)).max(9).optional(),
    ...labelFieldsSchema,
    /** 可选投票（仅短动态）：选项 2–5 项、权重 ≤32（16 汉字/32 字符）、最长 30 天 */
    poll: z
      .object({
        mode: z.enum(["single", "multiple", "pk"]),
        options: z.array(z.string().trim().min(1).max(64)).min(POLL_OPTIONS_MIN).max(POLL_OPTIONS_MAX),
        endsAt: z.coerce.date(),
      })
      .optional(),
    action: z.enum(["draft", "submit"]),
  })
  .refine((v) => v.type !== "article" || v.content.trim().length > 0, {
    message: "文章内容不能为空 / Article content cannot be empty",
    path: ["content"],
  })
  .refine(
    (v) =>
      v.type !== "short" ||
      (v.content.length <= SHORT_CONTENT_MAX &&
        (v.content.trim().length > 0 ||
          (v.mediaPaths?.length ?? 0) > 0 ||
          v.poll !== undefined)),
    {
      message: `短动态最多 ${SHORT_CONTENT_MAX} 字，文字、图片与投票至少其一`,
      path: ["content"],
    },
  );

/** Postgres unique_violation 检测（public_id 唯一约束兜底用）。 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    const body = parseWith(createSchema, await jsonBody(req));
    // 桶 write.post：per-user 默认 10 次/小时，zod 校验通过后再计数
    await rateLimitBucket("write.post", auth.user.id);
    const type = body.type;
    const title = body.title?.trim() || null;

    // short-post images are appended to content as markdown image syntax
    const imageMarkdown = (body.mediaPaths ?? [])
      .map((p) => `![](${p.startsWith("/") ? p : routes.media(p)})`)
      .join("\n");
    const content =
      type === "short" && imageMarkdown
        ? `${body.content.trim()}${body.content.trim() ? "\n\n" : ""}${imageMarkdown}`
        : body.content;

    if (body.collectionId) await assertCollectionOwned(body.collectionId, auth.user.id);

    // poll 选项/截止时间的语义校验（长度权重、2–5 项、时间窗）
    const pollRow =
      body.type === "short" && body.poll
        ? (() => {
            const err = validatePollOptionsForMode(body.poll.mode, body.poll.options);
            if (err) throw new AppError(err, 400, "validation_error");
            const endsAt = body.poll.endsAt;
            const t = endsAt.getTime();
            if (!Number.isFinite(t) || t <= Date.now()) {
              throw new AppError("投票结束时间必须晚于现在 / Poll end must be in the future", 400, "validation_error");
            }
            if (t - Date.now() > POLL_MAX_DURATION_DAYS * 86_400_000) {
              throw new AppError(`投票最长持续 ${POLL_MAX_DURATION_DAYS} 天`, 400, "validation_error");
            }
            return { mode: body.poll.mode, options: body.poll.options, endsAt };
          })()
        : null;

    // hard keyword gate — nothing is persisted when blocked
    if (body.action === "submit") {
      const { blocked } = await preSubmitCheck(title ?? "", content);
      if (blocked.length) return blockedResponse(blocked);
    }

    const summary = ensureSummary(body.summary, content || title || "");
    const labelColumns = resolveLabelFields(
      body.label ?? DEFAULT_LABEL,
      body.sourceUrl,
      body.sourceName,
    );

    /**
     * 单事务覆盖 post + topics + poll 的全部写入，任一失败整体回滚
     * （原先 postRepo.create 与 topics/poll 是两个独立事务，中途失败会留下
     * 缺 topics/poll 的半成品文章）。post:saving / post:saved 钩子仍经
     * @/core/capabilities/post-lifecycle 触发，与仓储层同款上下文；
     * post:saved 移到提交后触发，保证监听方经连接池读取时行已可见。
     *
     * public_id 唯一性加固：CSPRNG 撞码概率 ~1/10^18，理论上仍可能 ——
     * 唯一约束报 23505 时换新 id 重试整个事务（至多 3 次），创建永不因撞码失败。
     */
    const attemptCreate = async (): Promise<Post> => {
      return db.transaction(async (tx): Promise<Post> => {
        const payload: Record<string, unknown> = {
          authorId: auth.user.id,
          type,
          publicId: newPublicId(),
          title,
          summary,
          content,
          coverPath: body.coverPath ?? null,
          collectionId: body.collectionId ?? null,
          status: body.action === "submit" ? "pending_review" : "draft",
          visibility: body.visibility ?? "public",
          ...labelColumns,
        };
        // post:saving 钩子（扩展可改写载荷或拒绝保存）
        const savingCtx = {
          action: "create" as const,
          payload,
          author: { id: auth.user.id, username: auth.user.username, role: auth.user.role },
          rejection: null as string | null,
          reject(reason: string) {
            savingCtx.rejection = reason;
          },
        };
        await runPostSaving(savingCtx);
        if (savingCtx.rejection) {
          throw new AppError(savingCtx.rejection, 422, "extension_rejected");
        }

        const [row] = await tx.insert(posts).values(payload as typeof posts.$inferInsert).returning();

        if (body.topicNames?.length) await syncPostTopics(tx, row.id, body.topicNames);
        if (pollRow) {
          await tx.insert(polls).values({
            postId: row.id,
            mode: pollRow.mode,
            options: pollRow.options,
            endsAt: pollRow.endsAt,
          });
        }
        return row;
      });
    };

    let post: Post | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        post = await attemptCreate();
        break;
      } catch (err) {
        if (isUniqueViolation(err) && attempt < 2) continue;
        if (isUniqueViolation(err)) {
          throw conflict("内容标识冲突，请重试 / Identifier conflict, retry");
        }
        throw err;
      }
    }
    if (!post) {
      // 循环耗尽仍撞码（理论概率 ~1/10^18 × 3）：转为明确的用户可重试错误
      throw conflict("内容标识冲突，请重试 / Identifier conflict, retry");
    }

    await runPostSaved({
      action: "create",
      post: { id: post.id, type: post.type, status: post.status, title: post.title },
      author: { id: auth.user.id },
    });

    // 投票结束任务：到点拉取计票并给作者与投票用户发结果通知；
    // 帖子被删/未发布时 worker 直接跳过。
    if (pollRow) {
      await queue.send(
        "ext.job",
        { extensionId: "poll", task: "end", payloadJson: JSON.stringify({ postId: post.id }) },
        {
          startAfterSeconds: Math.max(
            60,
            Math.round((pollRow.endsAt.getTime() - Date.now()) / 1000),
          ),
        },
      );
    }

    if (body.action === "submit") {
      // reviewMode=off → the moderation plugin publishes right away and emits
      // post:published; otherwise it queues the review pipeline.
      await emit("post:submitted", {
        postId: post.id,
        authorId: auth.user.id,
        title: post.title ?? "",
        needReview: true,
      });
    }

    return ok(post);
  });
}
