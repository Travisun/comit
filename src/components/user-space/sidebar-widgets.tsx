import Link from "next/link";
import { Globe, ExternalLink, MessageCircle } from "lucide-react";
import type { User } from "@/db/schema";
import { routes } from "@/core/routes";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/social/follow-button";

/** GitHub mark (lucide dropped brand icons; keep the recognizable octocat glyph). */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Compact profile card for the sidebar: avatar, name, bio, links, follow.
 */

export function ProfileCard({
  user,
  viewerName,
  viewerFollowing,
}: {
  user: User;
  viewerName: string | null;
  viewerFollowing: boolean;
}) {
  const isSelf = viewerName === user.username;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Link href={routes.profile(user.username)}>
          <Avatar className="size-12 border border-border">
            {user.avatarPath && <AvatarImage src={routes.media(user.avatarPath)} alt={user.displayName} />}
            <AvatarFallback className="text-base">{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0">
          <Link href={routes.profile(user.username)} className="block truncate font-semibold hover:underline">
            {user.displayName}
          </Link>
          <div className="truncate text-xs text-muted-foreground">@{user.username}</div>
        </div>
      </div>

      {user.bio && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{user.bio}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <SocialLinks user={user} />
      </div>

      <div className="mt-4">
        {viewerName && !isSelf ? (
          <FollowButton username={user.username} initialFollowing={viewerFollowing} className="w-full" />
        ) : (
          !viewerName && (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href={routes.login}>关注</Link>
            </Button>
          )
        )}
        {isSelf && (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={routes.settings()}>编辑资料</Link>
          </Button>
        )}
      </div>

      {viewerName && !isSelf && user.dmEnabled && (
        <Button asChild variant="ghost" size="sm" className="mt-2 w-full text-muted-foreground">
          <Link href={routes.conversation(user.id)}>
            <MessageCircle className="size-3.5" /> 私信
          </Link>
        </Button>
      )}
    </section>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

/** Social / identity link row (GitHub, ORCID, website, RSS). */
export function SocialLinks({
  user,
  size = "sm",
}: {
  user: Pick<User, "github" | "orcid" | "website" | "rssEnabled" | "username">;
  size?: "sm" | "md";
}) {
  const icon = size === "sm" ? "size-3.5" : "size-4";
  const cls = "inline-flex items-center gap-1 hover:text-foreground";
  return (
    <>
      {user.github && (
        <a href={`https://github.com/${user.github}`} target="_blank" rel="noreferrer" className={cls}>
          <GithubMark className={icon} /> {size === "md" ? `github.com/${user.github}` : user.github}
        </a>
      )}
      {user.orcid && (
        <a href={`https://orcid.org/${user.orcid}`} target="_blank" rel="noreferrer" className={cls}>
          <ExternalLink className={icon} /> ORCID
        </a>
      )}
      {user.website && (
        <a href={user.website} target="_blank" rel="noreferrer" className={cls}>
          <Globe className={icon} /> {hostOf(user.website)}
        </a>
      )}
      {user.rssEnabled && (
        <Link href={routes.userRss(user.username)} className={cls}>
          RSS
        </Link>
      )}
    </>
  );
}

/** Small helper for stat number + label. */
export function StatChip({ value, label }: { value: number; label: string }) {
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      <strong className="num font-semibold">{value}</strong> {label}
    </Badge>
  );
}
