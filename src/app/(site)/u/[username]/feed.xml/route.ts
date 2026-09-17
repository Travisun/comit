import { notFound } from "next/navigation";
import { getActiveUserByUsername, getUserRssPosts } from "@/components/user-space/queries";
import { buildUserFeed, feedResponse } from "@/components/user-space/rss";
import { routeParam } from "@/lib/route-params";

export const dynamic = "force-dynamic";

/** GET /u/[username]/feed.xml[?type=atom] — per-user article feed. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const user = await getActiveUserByUsername(routeParam(username).toLowerCase());
  if (!user || !user.rssEnabled) notFound();

  const posts = await getUserRssPosts(user.id, 40);
  const feed = buildUserFeed(user, posts);
  return feedResponse(feed, new URL(req.url).searchParams.get("type"));
}
