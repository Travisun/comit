import Link from "next/link";
import { routes } from "@/core/routes";
import { timeAgo } from "@/lib/utils";
import { FollowButton } from "@/components/social/follow-button";
import { TimelineHeader } from "@/components/site-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { BadgeChipRow } from "@/extensions/badges/badge-ui";

export interface DetailAuthorBrief {
  username: string;
  displayName: string;
  avatarPath: string | null;
}

/**
 * 详情页统一作者栏 — 长文详情（/post/[slug]）与短动态详情（/p/[id]）共用，
 * 由本组件标准化以下此前各自实现、样式漂移的细节：
 *  - 头像（统一 Avatar 原语 + 首字母 fallback）；
 *  - 名字链接 / @username · 相对时间 副行；
 *  - 右侧动作：登录且非本人 → 关注按钮；本人或游客 → 「主页」入口。
 * 基座是 TimelineHeader（back 返回键 / sticky 行为继承壳组件）。
 */
export function DetailAuthorBar({
  author,
  date,
  locale = "zh",
  viewerPresent,
  isSelf,
  following = false,
  subline,
  badges,
}: {
  author: DetailAuthorBrief;
  /** 帖子时间（publishedAt ?? createdAt）— 副行展示相对时间 */
  date: Date | string;
  locale?: "zh" | "en";
  /** 是否存在登录观众（未登录时右侧退化为「主页」链接） */
  viewerPresent: boolean;
  isSelf: boolean;
  /** 当前观众与作者的关注关系（登录且非本人时用于关注按钮初值） */
  following?: boolean;
  /** 追加在副行末尾的内容（如作者预览态的「草稿/回收站」标记） */
  subline?: React.ReactNode;
  badges?: { text: string; icon: string; style: string }[];
}) {
  return (
    <TimelineHeader
      back
      rowClassName="py-3"
      title={
        <span className="flex items-center gap-2.5 whitespace-normal">
          <Avatar className="size-9 shrink-0 border border-border">
            {author.avatarPath && (
              <AvatarImage src={routes.media(author.avatarPath)} alt={author.displayName} />
            )}
            <AvatarFallback>{author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 leading-tight">
            <Link
              href={routes.profile(author.username)}
              className="block truncate text-[15px] font-medium text-foreground hover:underline"
            >
              {author.displayName}
            </Link>
            {badges && <BadgeChipRow badges={badges} />}
            <span className="block truncate text-xs text-muted-foreground">
              @{author.username} · {timeAgo(date, locale)}
              {subline}
            </span>
          </span>
        </span>
      }
      right={
        viewerPresent && !isSelf ? (
          <FollowButton
            username={author.username}
            initialFollowing={following}
            className="h-8 min-h-0 shrink-0 rounded-full px-4 text-xs font-medium"
          />
        ) : (
          <Link
            href={routes.profile(author.username)}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-border px-4 text-xs font-medium text-foreground transition-colors hover:bg-hover"
          >
            主页
          </Link>
        )
      }
    />
  );
}
