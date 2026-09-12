import { count, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { postTopics, topics } from "@/db/schema";
import { ok, withUser } from "@/lib/http";

/**
 * GET /api/posts/topics?q=<query> — fuzzy topic lookup for the editor's
 * topic-input suggestions, most-used first → { items: [{ id, name, slug, count }] }
 */
export async function GET(req: Request): Promise<Response> {
  return withUser(req, async () => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
    const rows = await db
      .select({
        id: topics.id,
        name: topics.name,
        slug: topics.slug,
        count: count(postTopics.postId),
      })
      .from(topics)
      .leftJoin(postTopics, eq(postTopics.topicId, topics.id))
      .where(q ? ilike(topics.name, `%${q}%`) : undefined)
      .groupBy(topics.id)
      .orderBy(desc(count(postTopics.postId)), topics.name)
      .limit(10);
    return ok({ items: rows });
  });
}
