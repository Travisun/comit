import Link from "next/link";
import type { ReactNode } from "react";
import { Flame, Hash, BookOpen } from "lucide-react";
import type { User } from "@/db/schema";
import { routes } from "@/core/routes";
import { cn } from "@/lib/utils";
import {
  getArchives,
  getUserHotPosts,
  getUserTopicCloud,
} from "./queries";
import { DEFAULT_WIDGETS } from "./widget-catalog";
import { ProfileCard } from "./sidebar-widgets";
import type { FeedItemDTO } from "./types";

/**
 * User-space sidebar: renders the widgets the user picked (in their order),
 * falling back to the catalog defaults when nothing is configured.
 */
export async function UserSidebar({
  user,
  viewerName,
  viewerFollowing,
  className,
}: {
  user: User;
  /** username of the logged-in viewer (null when anonymous) */
  viewerName: string | null;
  /** does the viewer follow this user (for the profile-card follow button) */
  viewerFollowing: boolean;
  /** layout classes from the caller (column position) */
  className?: string;
}) {
  const ids = (Array.isArray(user.widgets) ? user.widgets : []).filter((id) =>
    DEFAULT_WIDGETS.includes(id),
  );
  const ordered = ids.length > 0 ? [...new Set(ids)] : DEFAULT_WIDGETS;

  return (
    <aside className={className}>
      <div className="space-y-4 xl:sticky xl:top-4">
        {ordered.map((id) => {
          switch (id) {
            case "profile-card":
              return (
                <ProfileCard
                  key={id}
                  user={user}
                  viewerName={viewerName}
                  viewerFollowing={viewerFollowing}
                />
              );
            case "archives":
              return <ArchivesLazy key={id} userId={user.id} username={user.username} />;
            case "hot-posts":
              return <HotPostsWidget key={id} user={user} />;
            case "topic-cloud":
              return <TopicCloudWidget key={id} user={user} />;
            default:
              return null;
          }
        })}
      </div>
    </aside>
  );
}

/* ------------------------------- archives -------------------------------- */

async function ArchivesLazy({ userId, username }: { userId: string; username: string }) {
  const groups = await getArchives(userId);
  if (groups.length === 0) return null;
  const years = [...new Set(groups.map((g) => g.year))].sort((a, b) => b - a);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card p-4">
      <WidgetTitle icon={<BookOpen className="size-3.5" />} title="归档" />
      <div className="space-y-1.5">
        {years.map((year) => {
          const yearGroups = groups.filter((g) => g.year === year);
          const yearCount = yearGroups.reduce((s, g) => s + g.count, 0);
          return (
            <details key={year} className="group rounded-lg">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden">
                <span>{year} 年</span>
                <span className="text-xs text-muted-foreground">{yearCount}</span>
              </summary>
              <div className="mt-1 space-y-2 border-l border-border pl-3 ml-3">
                {yearGroups.map((g) => (
                  <details key={`${g.year}-${g.month}`} className="rounded-lg">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                      <span>{g.month} 月</span>
                      <span>{g.count}</span>
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {g.posts.map((p, i) =>
                        p.slug ? (
                          <li key={i}>
                            <Link
                              href={routes.article(p.slug)}
                              className="block truncate rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-primary"
                              title={p.title ?? undefined}
                            >
                              {p.title ?? "Untitled"}
                            </Link>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </details>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------- hot posts ------------------------------- */

async function HotPostsWidget({ user }: { user: User }) {
  const items: FeedItemDTO[] = (await getUserHotPosts(user.id, 5)).map((it) => ({
    post: {
      id: it.post.id,
      type: it.post.type,
      slug: it.post.slug,
      title: it.post.title,
      summary: "",
      content: "",
      coverPath: it.post.coverPath,
      visibility: it.post.visibility,
      views: it.post.views,
      likeCount: it.post.likeCount,
      commentCount: it.post.commentCount,
      repostCount: it.post.repostCount,
      publishedAt: it.post.publishedAt ? it.post.publishedAt.toISOString() : null,
    },
    author: it.author,
  }));
  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <WidgetTitle icon={<Flame className="size-3.5" />} title="热门文章" />
      <ol className="space-y-2.5">
        {items.map((it, i) => (
          <li key={it.post.id} className="flex items-baseline gap-2.5 text-sm">
            <span
              className={cn(
                "num inline-grid size-5 shrink-0 translate-y-0.5 place-items-center rounded-md text-xs font-bold",
                i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            {it.post.slug ? (
              <Link
                href={routes.article(it.post.slug ?? it.post.id)}
                className="line-clamp-2 text-sm leading-snug hover:text-primary"
              >
                {it.post.title ?? "Untitled"}
              </Link>
            ) : (
              <span className="line-clamp-2 text-sm leading-snug">{it.post.title ?? "Untitled"}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------ topic cloud ------------------------------ */

async function TopicCloudWidget({ user }: { user: User }) {
  const topics = await getUserTopicCloud(user.id, 14);
  if (topics.length === 0) return null;
  const max = Math.max(...topics.map((t) => t.postCount));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <WidgetTitle icon={<Hash className="size-3.5" />} title="话题云" />
      <div className="flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <Link
            key={t.slug}
            href={routes.topic(t.slug)}
            className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            style={{ fontSize: `${0.75 + (t.postCount / max) * 0.5}rem` }}
          >
            {t.name}
            <span className="ml-1 text-[10px] opacity-60">{t.postCount}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function WidgetTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground/90">
      <span className="text-primary">{icon}</span>
      {title}
    </h2>
  );
}
