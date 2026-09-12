import { getSiteRssPosts } from "@/components/user-space/queries";
import { buildSiteFeed, feedResponse } from "@/components/user-space/rss";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET /feed.xml[?type=atom] — site-wide feed of the latest published articles. */
export async function GET(req: Request) {
  const [siteName, siteDescription, posts] = await Promise.all([
    getSetting("site.name"),
    getSetting("site.description"),
    getSiteRssPosts(40),
  ]);
  const feed = buildSiteFeed(siteName, siteDescription, posts);
  return feedResponse(feed, new URL(req.url).searchParams.get("type"));
}
