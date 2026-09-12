import { notFound } from "next/navigation";
import { getActiveUserBySubdomain, getUserRssPosts } from "@/components/user-space/queries";
import { buildUserFeed, feedResponse } from "@/components/user-space/rss";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET /__sub/[subdomain]/feed.xml[?type=atom] — RSS for a subdomain blog. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ subdomain: string }> },
) {
  if (!(await getSetting("site.subdomains"))) notFound();

  const { subdomain } = await params;
  const user = await getActiveUserBySubdomain(decodeURIComponent(subdomain).toLowerCase());
  if (!user || !user.rssEnabled) notFound();

  const posts = await getUserRssPosts(user.id, 40);
  const feed = buildUserFeed(user, posts);
  return feedResponse(feed, new URL(req.url).searchParams.get("type"));
}
