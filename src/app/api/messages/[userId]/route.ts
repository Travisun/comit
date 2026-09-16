import { z } from "zod";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, users } from "@/db/schema";
import { AppError, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { hooks } from "@/core/hooks";
import { broadcast } from "@/core/capabilities/broadcast";
import { jsonBody, ok, withUser } from "@/lib/http";
import { assertNotBlocked, isFollowing } from "@/lib/users";

const querySchema = z.object({
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "invalid cursor")
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const postSchema = z
  .object({
    body: z.string().trim().min(1).max(2000).optional(),
    mediaPath: z.string().min(1).max(500).optional(),
  })
  .refine((v) => v.body !== undefined || v.mediaPath !== undefined, {
    message: "消息内容不能为空 / Message body or media required",
  });

/** Lexicographic pair ordering shared by lookup + insert (userAId < userBId). */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function findOrCreateConversation(me: string, them: string) {
  const [a, b] = orderedPair(me, them);
  const pair = or(
    and(eq(conversations.userAId, a), eq(conversations.userBId, b)),
    and(eq(conversations.userAId, b), eq(conversations.userBId, a)),
  );
  const [existing] = await db.select().from(conversations).where(pair).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(conversations)
    .values({ userAId: a, userBId: b })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(conversations).where(pair).limit(1);
  if (!raced) throw new AppError("会话创建失败 / Failed to open conversation", 500, "internal");
  return raced;
}

async function getOtherUser(userId: string) {
  const [other] = await db
    .select({ id: users.id, dmEnabled: users.dmEnabled, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return other ?? null;
}

/** GET /api/messages/[userId]?cursor=&limit= — ascending messages, marks read. */
export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  return withUser(req, async (auth) => {
    const { userId } = await ctx.params;
    if (!z.uuid().safeParse(userId).success) {
      throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    }
    const me = auth.user.id;
    if (userId === me) {
      return ok({ items: [], nextCursor: null });
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    const { cursor, limit } = parsed.data;

    const [a, b] = orderedPair(me, userId);
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userAId, a), eq(conversations.userBId, b)))
      .limit(1);

    if (!conv) return ok({ items: [], nextCursor: null });

    // opening the conversation marks the other party's messages as read
    const marked = await db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, conv.id),
          eq(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      )
      .returning({ id: messages.id });
    if (marked.length > 0) {
      void emit("message:read", { userId: me, peerId: userId, count: marked.length }).catch(
        () => undefined,
      );
    }

    // fetch the newest page, then flip to ascending for the client
    const conditions = [eq(messages.conversationId, conv.id)];
    if (cursor) conditions.push(lt(messages.createdAt, new Date(cursor)));

    const rows = await db
      .select({
        id: messages.id,
        body: messages.body,
        mediaPath: messages.mediaPath,
        senderId: messages.senderId,
        readAt: messages.readAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      id: r.id,
      body: r.body,
      mediaPath: r.mediaPath,
      mine: r.senderId === me,
      readAt: r.readAt,
      createdAt: r.createdAt,
    }));

    return ok({
      items: page.reverse(),
      nextCursor:
        hasMore && page.length > 0 ? page[0].createdAt.toISOString() : null,
    });
  });
}

/** POST /api/messages/[userId] — send a message (mutual follows required). */
export async function POST(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  return withUser(req, async (auth) => {
    const { userId } = await ctx.params;
    if (!z.uuid().safeParse(userId).success) {
      throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    }
    const me = auth.user.id;
    if (userId === me) {
      throw forbidden("不能给自己发私信 / You cannot message yourself");
    }

    const parsed = postSchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("消息内容不能为空 / Empty message", 400, "bad_request");

    const other = await getOtherUser(userId);
    if (!other || other.status !== "active") {
      throw notFound("用户不存在 / User not found");
    }

    await assertNotBlocked(me, userId);

    const [mine, theirs] = await Promise.all([
      isFollowing(me, userId),
      isFollowing(userId, me),
    ]);
    if (!mine || !theirs) {
      throw forbidden("互相关注后才能私信");
    }
    if (!other.dmEnabled) {
      throw forbidden("对方已关闭私信 / The recipient has disabled direct messages");
    }

    const conv = await findOrCreateConversation(me, userId);

    // 私信发送前钩子（扩展可拒绝：频控/内容过滤/自动回复前置等）
    const sendingCtx = {
      conversationId: conv.id,
      senderId: me,
      receiverId: userId,
      body: parsed.data.body ?? null,
      mediaPath: parsed.data.mediaPath ?? null,
      rejection: null as string | null,
      reject(reason: string) {
        sendingCtx.rejection = reason;
      },
    };
    await hooks.callHook("message:sending", sendingCtx);
    if (sendingCtx.rejection) {
      throw new AppError(sendingCtx.rejection, 422, "extension_rejected");
    }

    // 消息写入 + 会话 lastMessageAt 推进同事务（任一失败整体回滚）。
    // lastMessageAt 用 greatest()：乱序写入的旧 createdAt 不会把会话顶到最前
    //（timestamptz 列与参数化 Date 直接比较）。
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({
          conversationId: conv.id,
          senderId: me,
          body: parsed.data.body ?? null,
          mediaPath: parsed.data.mediaPath ?? null,
        })
        .returning();
      await tx
        .update(conversations)
        .set({ lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${row.createdAt})` })
        .where(eq(conversations.id, conv.id));
      return row;
    });

    // 钩子/实时推送在事务提交后触发（监听方经连接池读取时行已可见）
    await hooks.callHook("message:sent", {
      message: { id: created.id, conversationId: conv.id },
      senderId: me,
      receiverId: userId,
    });
    broadcast([userId], { type: "message.created", payload: { from: me, messageId: created.id } });

    void emit("message:created", {
      messageId: created.id,
      senderId: me,
      receiverId: userId,
      excerpt: created.body ?? "[图片]",
    });

    return ok({
      id: created.id,
      body: created.body,
      mediaPath: created.mediaPath,
      mine: true,
      readAt: created.readAt,
      createdAt: created.createdAt,
    });
  });
}
