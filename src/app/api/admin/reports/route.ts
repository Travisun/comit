import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts, reports, users } from "@/db/schema";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { pagination } from "@/app/api/admin/_shared";
import { makeExcerpt, truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ReportTargetPreview {
  kind: "post" | "comment" | "user";
  url: string;
  title: string;
  /** post → plain-text excerpt (≤500 chars); comment → body excerpt */
  excerpt?: string;
  /** post */
  postStatus?: string;
  /** comment */
  postId?: string;
  postTitle?: string;
  /** user */
  username?: string;
  displayName?: string;
  avatarPath?: string | null;
  userStatus?: string;
  postCount?: number;
  createdAt?: string;
  /** target row missing (deleted content / deleted user) */
  missing?: boolean;
}

/**
 * GET /api/admin/reports?status=open|resolved|dismissed|all&type=post|comment|user
 * &limit=50&offset= — report queue with an inline `targetPreview` per row so the
 * workbench can render the reported object without extra round-trips.
 */
export async function GET(req: Request) {
  return withPermission(req, "admin.moderate", async () => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status") ?? "all";
    const type = url.searchParams.get("type") ?? "";
    const { limit, offset } = pagination(url, { defaultLimit: 50 });

    const conds: SQL[] = [];
    if (statusParam === "open" || statusParam === "resolved" || statusParam === "dismissed") {
      conds.push(eq(reports.status, statusParam));
    }
    if (type === "post" || type === "comment" || type === "user") {
      conds.push(eq(reports.targetType, type));
    }
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ n: total }]] = await Promise.all([
      db
        .select({
          id: reports.id,
          targetType: reports.targetType,
          targetId: reports.targetId,
          reason: reports.reason,
          status: reports.status,
          createdAt: reports.createdAt,
          reporter: { username: users.username, displayName: users.displayName },
        })
        .from(reports)
        .innerJoin(users, eq(users.id, reports.reporterId))
        .where(where)
        .orderBy(desc(reports.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(reports).where(where),
    ]);

    // batch-resolve target context per type
    const postIds = rows.filter((r) => r.targetType === "post").map((r) => r.targetId);
    const commentIds = rows.filter((r) => r.targetType === "comment").map((r) => r.targetId);
    const userIds = rows.filter((r) => r.targetType === "user").map((r) => r.targetId);

    const postMap = new Map<
      string,
      { title: string | null; excerpt: string; status: string; username: string | null }
    >();
    const commentMap = new Map<
      string,
      { postId: string; body: string; postTitle: string | null; username: string | null }
    >();
    const userMap = new Map<
      string,
      {
        username: string;
        displayName: string;
        avatarPath: string | null;
        status: string;
        postCount: number;
        createdAt: Date;
      }
    >();

    const authorName = sql<string | null>`(select u2.username from ${users} u2 where u2.id = ${posts.authorId})`;

    await Promise.all([
      postIds.length
        ? db
            .select({
              id: posts.id,
              title: posts.title,
              content: posts.content,
              status: posts.status,
              username: authorName,
            })
            .from(posts)
            .where(inArray(posts.id, postIds))
            .then((rs) =>
              rs.forEach((r) =>
                postMap.set(r.id, {
                  title: r.title,
                  excerpt: makeExcerpt(r.content, 500),
                  status: r.status,
                  username: r.username,
                }),
              ),
            )
        : Promise.resolve(),
      commentIds.length
        ? db
            .select({
              id: comments.id,
              postId: comments.postId,
              body: comments.body,
              postTitle: posts.title,
              username: users.username,
            })
            .from(comments)
            .innerJoin(posts, eq(posts.id, comments.postId))
            .innerJoin(users, eq(users.id, comments.userId))
            .where(inArray(comments.id, commentIds))
            .then((rs) =>
              rs.forEach((r) =>
                commentMap.set(r.id, {
                  postId: r.postId,
                  body: r.body,
                  postTitle: r.postTitle,
                  username: r.username,
                }),
              ),
            )
        : Promise.resolve(),
      userIds.length
        ? db
            .select({
              id: users.id,
              username: users.username,
              displayName: users.displayName,
              avatarPath: users.avatarPath,
              status: users.status,
              createdAt: users.createdAt,
              postCount: sql<number>`(select count(*) from ${posts} where ${posts.authorId} = ${users.id})`.mapWith(
                Number,
              ),
            })
            .from(users)
            .where(inArray(users.id, userIds))
            .then((rs) =>
              rs.forEach((r) =>
                userMap.set(r.id, {
                  username: r.username,
                  displayName: r.displayName,
                  avatarPath: r.avatarPath,
                  status: r.status,
                  postCount: r.postCount,
                  createdAt: r.createdAt,
                }),
              ),
            )
        : Promise.resolve(),
    ]);

    const items = rows.map((r) => {
      let preview: ReportTargetPreview = {
        kind: "post",
        url: `/p/${r.targetId}`,
        title: "（已删除 / deleted）",
        missing: true,
      };
      if (r.targetType === "post") {
        const p = postMap.get(r.targetId);
        preview = p
          ? {
              kind: "post",
              url: `/p/${r.targetId}`,
              title: p.title ?? "（无标题）",
              excerpt: p.excerpt,
              postStatus: p.status,
              username: p.username ?? undefined,
              missing: false,
            }
          : { ...preview, kind: "post" };
      } else if (r.targetType === "comment") {
        const c = commentMap.get(r.targetId);
        preview = c
          ? {
              kind: "comment",
              url: `/p/${c.postId}`,
              title: truncate(c.body, 80),
              excerpt: truncate(c.body, 300),
              postId: c.postId,
              postTitle: c.postTitle ?? "（无标题动态）",
              username: c.username ?? undefined,
              missing: false,
            }
          : { ...preview, kind: "comment" };
      } else if (r.targetType === "user") {
        const u = userMap.get(r.targetId);
        preview = u
          ? {
              kind: "user",
              url: `/u/${u.username}`,
              title: `${u.displayName} (@${u.username})`,
              username: u.username,
              displayName: u.displayName,
              avatarPath: u.avatarPath,
              userStatus: u.status,
              postCount: u.postCount,
              createdAt: u.createdAt.toISOString(),
              missing: false,
            }
          : { ...preview, kind: "user" };
      }
      return { ...r, targetPreview: preview };
    });

    return ok({ items, total });
  });
}
