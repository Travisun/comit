import { and, count, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, users } from "@/db/schema";
import { ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";

/** GET /api/messages/conversations — list the current user's conversations. */
export async function GET(req: Request) {
  return withUser(req, async (auth) => {
    await rateLimitBucket("read.messages", auth.user.id);
    const me = auth.user.id;

    // 会话数不设防会被脚本化拉取放大成无界 join+聚合（DB DoS 面）；
    // 200 远超真实私信场景，超出部分按 lastMessageAt 序自然截断
    const convs = await db
      .select()
      .from(conversations)
      .where(or(eq(conversations.userAId, me), eq(conversations.userBId, me)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(200);

    if (convs.length === 0) return ok([]);

    const convIds = convs.map((c) => c.id);
    const otherIds = convs
      .map((c) => (c.userAId === me ? c.userBId : c.userAId))
      .filter((id) => id !== me);

    const [others, lastRows, unreadRows] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarPath: users.avatarPath,
        })
        .from(users)
        .where(inArray(users.id, otherIds.length > 0 ? otherIds : [me])),
      db
        .selectDistinctOn([messages.conversationId], {
          conversationId: messages.conversationId,
          senderId: messages.senderId,
          body: messages.body,
          mediaPath: messages.mediaPath,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, convIds))
        .orderBy(messages.conversationId, desc(messages.createdAt)),
      db
        .select({ conversationId: messages.conversationId, n: count() })
        .from(messages)
        .where(
          and(
            inArray(messages.conversationId, convIds),
            ne(messages.senderId, me),
            isNull(messages.readAt),
          ),
        )
        .groupBy(messages.conversationId),
    ]);

    const usersById = new Map(others.map((u) => [u.id, u]));
    const lastById = new Map(lastRows.map((m) => [m.conversationId, m]));
    const unreadById = new Map(unreadRows.map((r) => [r.conversationId, Number(r.n)]));

    const items = convs
      .map((c) => {
        const otherId = c.userAId === me ? c.userBId : c.userAId;
        const other = usersById.get(otherId);
        if (!other) return null;
        const last = lastById.get(c.id) ?? null;
        return {
          userId: other.id,
          username: other.username,
          displayName: other.displayName,
          avatarPath: other.avatarPath,
          lastMessage: last
            ? {
                body: last.mediaPath && !last.body ? "[图片]" : (last.body ?? "[图片]"),
                createdAt: last.createdAt,
                mine: last.senderId === me,
              }
            : null,
          unread: unreadById.get(c.id) ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return ok(items);
  });
}
