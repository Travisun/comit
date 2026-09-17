import { notFound, permanentRedirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { routes } from "@/core/routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

/**
 * Legacy short-post permalink (/p/{id}) — canonical 是 /post/{internalId}
 * （与个人主页 /{username} 同一套 id 直链机制）。旧链接 308 永久重定向。
 */
export default async function LegacyShortPostPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  // canonical 已切 publicId 数字串：按内部 uuid 找到对应 publicId 再跳
  const [row] = await db
    .select({ publicId: posts.publicId })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!row) notFound();
  permanentRedirect(routes.post(row.publicId));
}
