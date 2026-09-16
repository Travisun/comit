import { Suspense } from "react";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { follows, posts } from "@/db/schema";
import { Skeleton } from "@/components/ui/primitives";
import { SiteRail } from "@/components/site-rail";
import {
  getActiveAuthors,
  getCommunityStats,
  getTrendingTopics,
} from "@/components/user-space/queries";
import type { ShellUser } from "@/components/site-shell";

/**
 * 右栏 rail 的流式封装 — 从 (site)/layout 主链拆出的独立 async server 组件。
 *
 * 之前 layout 串行 await 完 rail 的 5 组查询（topics/authors/stats + 本人
 * posts/followers/following 计数）才返回整树，拖慢 TTFB；现在主链只保留
 * locale/站点名/会话与导航未读数，rail 由 <Suspense> 包裹独立流式注入，
 * 骨架先出、数据后到。查询复用 user-space/queries 现有函数，best-effort
 * 语义与原实现一致（db 未就绪时 rail 渲染为空卡片集，不影响整页）。
 */

/** 骨架与 rail 结构对齐：搜索框 + 两张卡片占位。 */
function RailSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="sticky top-0 z-10 -mx-5 bg-card/80 px-5 pt-[15px] pb-3 backdrop-blur-md">
        <Skeleton className="h-10 w-full rounded-full" />
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

async function RailContent({ user, siteName }: { user: ShellUser | null; siteName: string }) {
  // rail 三查询（topics / authors / community stats）— best-effort
  const topics = await getTrendingTopics(7).catch(() => []);
  const authors = await getActiveAuthors(3).catch(() => []);
  const stats = await getCommunityStats().catch(() => null);

  // viewer's own blog stats for the rail console card (best-effort)
  let myStats: { posts: number; followers: number; following: number } | null = null;
  if (user) {
    try {
      const [[p], [f], [g]] = await Promise.all([
        db
          .select({ n: count() })
          .from(posts)
          .where(and(eq(posts.authorId, user.id), eq(posts.status, "published"))),
        db.select({ n: count() }).from(follows).where(eq(follows.followeeId, user.id)),
        db.select({ n: count() }).from(follows).where(eq(follows.followerId, user.id)),
      ]);
      myStats = { posts: p.n, followers: f.n, following: g.n };
    } catch {
      // db not ready — card renders without stats
    }
  }

  return (
    <SiteRail
      siteName={siteName}
      topics={topics}
      authors={authors}
      stats={stats}
      myStats={myStats}
      user={
        user
          ? { displayName: user.displayName, username: user.username, avatarPath: user.avatarPath }
          : null
      }
    />
  );
}

/** layout 里以 rail prop 传入 SiteShell（ReactNode），Suspense 边界随流注入。 */
export function SiteRailSection({ user, siteName }: { user: ShellUser | null; siteName: string }) {
  return (
    <Suspense fallback={<RailSkeleton />}>
      <RailContent user={user} siteName={siteName} />
    </Suspense>
  );
}
