import Link from "next/link";
import {
  CalendarDays,
  FolderOpen,
  LayoutDashboard,
  MessageCircle,
  PenLine,
} from "lucide-react";
import type { User } from "@/db/schema";
import { routes } from "@/core/routes";
import { cn, formatDate } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/social/follow-button";
import { BlockButton } from "@/components/social/block-button";
import {
  getActiveUserByUsername,
  getFollowState,
  getPublishedPosts,
  getTopPosts,
  getUserCollections,
  getUserStats,
  listFollowers,
  listFollowing,
  toFeedItemDTO,
  type UserCard,
} from "./queries";
import { VerifiedBadge } from "./verified-badge";
import { ArticleCard } from "./article-card";
import { ShortCard } from "./short-card";
import { SocialLinks } from "./sidebar-widgets";
import type { UserStats, ViewerFollowState } from "./types";

/**
 * X-style user profile, shared by:
 *  - /u/[username]                (path-based)
 *  - /__sub/[subdomain]/[[...path (subdomain rewrite, viaSubdomain=true)
 *  - single-user site home        (SingleUserHome below)
 *
 * Layout: 600px timeline column (banner + identity + underline tabs + content)
 * with the user's widget sidebar as an optional 300px right column.
 */

const PAGE_SIZE = 10;

/* --------------------------------- hero ---------------------------------- */

export function ProfileHero({
  user,
  stats,
  viewerState,
  isSelf,
  variant = "page",
}: {
  user: User;
  stats: UserStats;
  viewerState: ViewerFollowState | null;
  isSelf: boolean;
  /** "page": normal profile hero; "site": taller banner for single-user home */
  variant?: "page" | "site";
}) {
  const bannerH = variant === "site" ? "h-48 md:h-64" : "h-36 md:h-48";
  return (
    <section>
      {/* banner — full width of the column, squared corners, bottom border */}
      <div className={cn("relative w-full overflow-hidden border-b border-border", bannerH)}>
        {user.coverPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={routes.media(user.coverPath)}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--muted)] to-[var(--selected)]" />
        )}
      </div>

      <div className="px-4 pb-3">
        {/* identity row */}
        <div className="flex items-start justify-between gap-3">
          <Avatar className="size-24 -mt-12 ring-4 ring-card">
            {user.avatarPath && (
              <AvatarImage src={routes.media(user.avatarPath)} alt={user.displayName} />
            )}
            <AvatarFallback className="text-2xl font-bold">
              {user.displayName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-wrap items-center gap-2 pt-3">
            {isSelf ? (
              <>
                <Button asChild size="sm" className="rounded-full font-medium">
                  <Link href={routes.editorNew("article")}>
                    <PenLine className="size-4" /> 写文章
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-full font-medium">
                  <Link href="/write/posts">
                    <LayoutDashboard className="size-4" /> 管理文章
                  </Link>
                </Button>
              </>
            ) : (
              viewerState && <ProfileActions user={user} viewerState={viewerState} />
            )}
          </div>
        </div>

        <div className="mt-2">
          <h1 className="inline-flex items-center gap-1.5 text-xl font-normal">
            {user.displayName}
            <VerifiedBadge verified={user.verified} size="md" />
          </h1>
          <div className="text-[15px] text-muted-foreground">@{user.username}</div>
        </div>

        {user.bio && (
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{user.bio}</p>
        )}

        {/* meta row: follow-back chip + social links + joined date */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {viewerState?.followedBy && <Badge variant="secondary">关注了你</Badge>}
          <SocialLinks user={user} size="md" />
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-4" /> {formatDate(user.createdAt, "zh")} 加入
          </span>
        </div>

        {/* X-style inline stats */}
        <div
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
          aria-label="用户统计"
        >
          <StatLink value={stats.following} label="关注中" username={user.username} tab="following" />
          <StatLink value={stats.followers} label="关注者" username={user.username} tab="followers" />
          <Stat value={stats.likesReceived} label="获赞" />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="text-muted-foreground">
      <strong className="num font-semibold text-foreground">{value}</strong> {label}
    </span>
  );
}

function StatLink({
  value,
  label,
  username,
  tab,
}: {
  value: number;
  label: string;
  username: string;
  tab: ProfileTab;
}) {
  return (
    <Link
      href={`${routes.profile(username)}?tab=${tab}`}
      className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
    >
      <strong className="num font-semibold text-foreground">{value}</strong> {label}
    </Link>
  );
}

function ProfileActions({
  user,
  viewerState,
}: {
  user: User;
  viewerState: ViewerFollowState;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FollowButton
        username={user.username}
        initialFollowing={viewerState.following}
        className="rounded-full font-medium"
      />
      {user.dmEnabled ? (
        <Button asChild variant="outline" size="sm" className="rounded-full font-medium">
          <Link href={routes.conversation(user.id)}>
            <MessageCircle className="size-4" /> 私信
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="rounded-full" disabled>
          已关闭私信
        </Button>
      )}
      <BlockButton username={user.username} initialBlocked={viewerState.blocking} />
    </div>
  );
}

/* ------------------------------ profile view ------------------------------ */

export type ProfileTab = "posts" | "short" | "collections" | "followers" | "following";

export async function UserProfileView({
  user,
  viewer,
  tab = "posts",
  page = 0,
}: {
  user: User;
  /** full viewer row or null */
  viewer: User | null;
  viaSubdomain?: boolean;
  tab?: ProfileTab;
  page?: number;
}) {
  const isSelf = Boolean(viewer && viewer.id === user.id);
  const viewerState = isSelf ? null : await getFollowState(viewer?.id ?? null, user.id);
  const stats = await getUserStats(user.id);

  return (
    <main className="w-full">
      <ProfileHero user={user} stats={stats} viewerState={viewerState} isSelf={isSelf} />

      <ProfileTabs username={user.username} active={tab} />

      <div>
        {tab === "posts" && <PostsTab user={user} page={page} tab={tab} stats={stats} />}
        {tab === "short" && <ShortsTab user={user} page={page} tab={tab} />}
        {tab === "collections" && <CollectionsTab user={user} />}
        {tab === "followers" && <FollowsTab user={user} mode="followers" viewer={viewer} />}
        {tab === "following" && <FollowsTab user={user} mode="following" viewer={viewer} />}
      </div>
    </main>
  );
}

/* ---------------------------------- tabs ---------------------------------- */

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "posts", label: "文章" },
  { id: "short", label: "动态" },
  { id: "collections", label: "合集" },
  { id: "followers", label: "粉丝" },
  { id: "following", label: "关注中" },
];

function ProfileTabs({ username, active }: { username: string; active: ProfileTab }) {
  return (
    <nav
      className="sticky top-12 z-20 border-b border-border bg-card/85 backdrop-blur-md md:top-0"
      aria-label="Profile tabs"
    >
      <div className="grid auto-cols-fr grid-flow-col">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`${routes.profile(username)}?tab=${t.id}`}
            aria-current={active === t.id ? "page" : undefined}
            className={cn(
              "relative grid place-items-center px-1 py-3.5 text-sm transition-colors",
              active === t.id
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground",
            )}
          >
            {t.label}
            {active === t.id && (
              <span className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-primary" />
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function Pager({
  username,
  tab,
  page,
  hasMore,
}: {
  username: string;
  tab: ProfileTab;
  page: number;
  hasMore: boolean;
}) {
  if (page === 0 && !hasMore) return null;
  const cls = "rounded-full border border-border px-4 py-1.5 font-medium transition-colors hover:bg-[var(--hover)]";
  return (
    <nav className="flex items-center justify-between px-4 py-4 text-sm" aria-label="Pagination">
      {page > 0 ? (
        <Link href={`${routes.profile(username)}?tab=${tab}&page=${page - 1}`} className={cls}>
          上一页
        </Link>
      ) : (
        <span />
      )}
      {hasMore ? (
        <Link href={`${routes.profile(username)}?tab=${tab}&page=${page + 1}`} className={cls}>
          下一页
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

async function PostsTab({ user, page, tab, stats }: { user: User; page: number; tab: ProfileTab; stats: UserStats }) {
  const [{ items, nextOffset }, top] = await Promise.all([
    getPublishedPosts({
      authorId: user.id,
      type: "article",
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    // 代表作：品牌主页的「作品集」门面，仅在内容达到一定量后展示
    stats.posts >= 4 ? getTopPosts(user.id, 2) : Promise.resolve([]),
  ]);
  if (items.length === 0) return <EmptyState text="还没有发布任何文章" />;

  const topIds = new Set(top.map((t) => t.post.id));
  const rest = items.filter((it) => !topIds.has(it.post.id));

  return (
    <div>
      {top.length > 0 &&
        top.map((it) => {
          const dto = toFeedItemDTO(it);
          return (
            <ArticleCard key={it.post.id} post={dto.post} author={dto.author} pinned />
          );
        })}

      {rest.map((it) => {
        const dto = toFeedItemDTO(it);
        return <ArticleCard key={it.post.id} post={dto.post} author={dto.author} variant="list" />;
      })}
      <Pager username={user.username} tab={tab} page={page} hasMore={nextOffset !== null} />
    </div>
  );
}

async function ShortsTab({ user, page, tab }: { user: User; page: number; tab: ProfileTab }) {
  const { items, nextOffset } = await getPublishedPosts({
    authorId: user.id,
    type: "short",
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  if (items.length === 0) return <EmptyState text="还没有发布任何动态" />;
  return (
    <div>
      {items.map((it) => {
        const dto = toFeedItemDTO(it);
        return <ShortCard key={it.post.id} post={dto.post} author={dto.author} />;
      })}
      <Pager username={user.username} tab={tab} page={page} hasMore={nextOffset !== null} />
    </div>
  );
}

async function FollowsTab({
  user,
  mode,
  viewer,
}: {
  user: User;
  mode: "followers" | "following";
  viewer: User | null;
}) {
  // 隐私开关：本人始终可见，其他人看到提示文案
  const hidden = mode === "followers" ? user.hideFollowers : user.hideFollowing;
  const isSelf = Boolean(viewer && viewer.id === user.id);
  if (hidden && !isSelf) {
    return <EmptyState text="由于用户的隐私设置，无法查看该列表。" />;
  }
  const cards = mode === "followers" ? await listFollowers(user.id) : await listFollowing(user.id);
  if (cards.length === 0) {
    return (
      <EmptyState
        text={mode === "followers" ? "还没有粉丝，持续创作会带来更多关注。" : "还没有关注任何人。"}
      />
    );
  }
  return (
    <ul>
      {cards.map((card) => (
        <li key={card.id} className="border-b border-border last:border-b-0">
          <FollowCard card={card} viewer={viewer} />
        </li>
      ))}
    </ul>
  );
}

async function FollowCard({ card, viewer }: { card: UserCard; viewer: User | null }) {
  const isSelf = Boolean(viewer && viewer.id === card.id);
  const viewerState = isSelf || !viewer ? null : await getFollowState(viewer.id, card.id);
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--hover)]">
      <Link href={routes.profile(card.username)} className="shrink-0">
        <Avatar className="size-10">
          {card.avatarPath && <AvatarImage src={routes.media(card.avatarPath)} alt={card.displayName} />}
          <AvatarFallback>{card.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={routes.profile(card.username)}
          className="inline-flex items-center gap-1 truncate text-[15px] font-medium hover:underline"
        >
          {card.displayName}
          <VerifiedBadge verified={card.verified} size="sm" />
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {card.bio ? card.bio : `@${card.username}`}
        </p>
      </div>
      {viewerState && (
        <FollowButton
          username={card.username}
          initialFollowing={viewerState.following}
          className="rounded-full font-medium"
        />
      )}
    </div>
  );
}

async function CollectionsTab({ user }: { user: User }) {
  const collections = await getUserCollections(user.id);
  if (collections.length === 0) return <EmptyState text="还没有创建合集" />;
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      {collections.map((c) => (
        <Link
          key={c.slug}
          href={routes.collection(user.username, c.slug)}
          className="group rounded-lg border border-border p-4 transition-colors hover:bg-[var(--hover)]"
        >
          <div className="flex items-center gap-2 text-[15px] font-normal">
            <FolderOpen className="size-4 text-primary/70" />
            {c.name}
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
          <div className="num mt-3 text-xs text-muted-foreground">{c.postCount} 篇文章</div>
        </Link>
      ))}
    </div>
  );
}


function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-6 py-14 text-center text-sm text-muted-foreground">{text}</div>
  );
}

/* ---------------------------- single-user home ---------------------------- */

/**
 * Site homepage in single-user mode: the chosen user's blog IS the site.
 * X-profile chrome (banner + avatar + identity + stats) followed by the
 * article timeline and the widget sidebar.
 */
export async function SingleUserHome({ user, viewer }: { user: User; viewer: User | null }) {
  const isSelf = Boolean(viewer && viewer.id === user.id);
  const [stats, viewerState, { items }] = await Promise.all([
    getUserStats(user.id),
    isSelf ? Promise.resolve(null) : getFollowState(viewer?.id ?? null, user.id),
    getPublishedPosts({ authorId: user.id, type: "article", limit: 20 }),
  ]);

  return (
    <main className="w-full">
      <ProfileHero user={user} stats={stats} viewerState={viewerState} isSelf={isSelf} variant="site" />

      <h2 className="border-b border-border px-4 pb-3 pt-4 text-[15px] font-normal">最新文章</h2>
      {items.length === 0 ? (
        <EmptyState text="还没有发布任何文章" />
      ) : (
        items.map((it) => {
          const dto = toFeedItemDTO(it);
          return <ArticleCard key={it.post.id} post={dto.post} author={dto.author} variant="list" />;
        })
      )}
    </main>
  );
}

/** Resolve a single-user-mode site owner (or null when unset/missing). */
export async function resolveSingleUser(username: string): Promise<User | null> {
  return getActiveUserByUsername(username);
}
