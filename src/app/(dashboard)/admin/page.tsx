"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Users, FileText, MessageSquare, Flag, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Skeleton,
} from "@/components/ui/primitives";
import {
  EmptyState,
  PageHeader,
  PostStatusBadge,
  PostTypeBadge,
  StatCard,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";

// 就地 zod schema：/api/admin/stats 响应无现成 schema，进缓存前校验把关
const statsResponseSchema = z.object({
  stats: z.object({
    totalUsers: z.number(),
    newUsersToday: z.number(),
    totalPosts: z.number(),
    pendingPosts: z.number(),
    totalComments: z.number(),
    openReports: z.number(),
  }),
  recentUsers: z.array(
    z.object({
      id: z.string(),
      username: z.string(),
      displayName: z.string(),
      avatarPath: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  recentPosts: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      type: z.string(),
      status: z.string(),
      publishedAt: z.string().nullable(),
      createdAt: z.string(),
      author: z.object({ username: z.string(), displayName: z.string() }),
    }),
  ),
});
type StatsResponse = z.infer<typeof statsResponseSchema>;

export default function AdminOverviewPage() {
  const { locale } = useI18n();
  // 概览统计 — 读数据统一走 TanStack Query，替代 useEffect + useState 手拉
  const statsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminStats(),
      url: "/api/admin/stats",
      schema: statsResponseSchema,
    }),
  );
  const data: StatsResponse | undefined = statsQ.data;

  return (
    <div>
      <PageHeader title="概览" description="站点运营数据一览" />

      {statsQ.error ? (
        <EmptyState title="加载失败" hint={statsQ.error.message} />
      ) : !data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="mt-2 h-8 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="pt-5">
              <TableSkeleton rows={6} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {/* stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <StatCard
                  label="总用户"
                  value={data.stats.totalUsers}
                  sub={`今日新增 ${data.stats.newUsersToday}`}
                  icon={<Users />}
                  href="/admin/users"
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <StatCard
                  label="文章总数"
                  value={data.stats.totalPosts}
                  sub={`待审核 ${data.stats.pendingPosts}`}
                  icon={<FileText />}
                  href="/admin/articles?status=pending_review"
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <StatCard
                  label="评论数"
                  value={data.stats.totalComments}
                  icon={<MessageSquare />}
                  href="/admin/comments"
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <StatCard
                  label="开放举报"
                  value={data.stats.openReports}
                  icon={<Flag />}
                  href="/admin/reports"
                />
              </CardContent>
            </Card>
          </div>

          {data.stats.pendingPosts > 0 || data.stats.openReports > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <ShieldAlert className="size-4 text-warning" />
              {data.stats.pendingPosts > 0 ? (
                <Link href="/admin/moderation" className="font-medium underline-offset-2 hover:underline">
                  {data.stats.pendingPosts} 篇文章待人工审核
                </Link>
              ) : null}
              {data.stats.pendingPosts > 0 && data.stats.openReports > 0 ? "，" : null}
              {data.stats.openReports > 0 ? (
                <Link href="/admin/reports" className="font-medium underline-offset-2 hover:underline">
                  {data.stats.openReports} 条举报待处理
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* recent users */}
          <Card>
            <CardHeader>
              <CardTitle>最近注册用户</CardTitle>
              <CardDescription>最新加入站点的 10 位用户</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentUsers.length === 0 ? (
                <EmptyState title="还没有用户注册" />
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>用户名</th>
                      <th className="text-right">注册时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link
                            href={`/u/${u.username}`}
                            target="_blank"
                            className="flex items-center gap-2.5 hover:underline"
                          >
                            <Avatar className="size-7">
                              {u.avatarPath ? <AvatarImage src={`/api/media/file/${u.avatarPath}`} /> : null}
                              <AvatarFallback>{u.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{u.displayName}</span>
                          </Link>
                        </td>
                        <td className="text-muted-foreground">@{u.username}</td>
                        <td className="text-right text-xs text-muted-foreground">
                          {timeAgo(u.createdAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          {/* recent posts */}
          <Card>
            <CardHeader>
              <CardTitle>最近发布文章</CardTitle>
              <CardDescription>最新发布的 10 篇内容</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentPosts.length === 0 ? (
                <EmptyState title="还没有已发布的内容" />
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>标题</th>
                      <th>作者</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th className="text-right">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentPosts.map((p) => (
                      <tr key={p.id}>
                        <td className="max-w-64">
                          <Link
                            href={`/p/${p.id}`}
                            target="_blank"
                            className="block truncate font-medium hover:underline"
                          >
                            {p.title ?? "（无标题）"}
                          </Link>
                        </td>
                        <td className="text-muted-foreground">@{p.author.username}</td>
                        <td>
                          <PostTypeBadge type={p.type} />
                        </td>
                        <td>
                          <PostStatusBadge status={p.status} />
                        </td>
                        <td className="text-right text-xs text-muted-foreground">
                          {timeAgo(p.publishedAt ?? p.createdAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
