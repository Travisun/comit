"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface StatsResponse {
  stats: {
    totalUsers: number;
    newUsersToday: number;
    totalPosts: number;
    pendingPosts: number;
    totalComments: number;
    openReports: number;
  };
  recentUsers: {
    id: string;
    username: string;
    displayName: string;
    avatarPath: string | null;
    createdAt: string;
  }[];
  recentPosts: {
    id: string;
    title: string | null;
    type: string;
    status: string;
    publishedAt: string | null;
    createdAt: string;
    author: { username: string; displayName: string };
  }[];
}

export default function AdminOverviewPage() {
  const { locale } = useI18n();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<StatsResponse>("/api/admin/stats")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <PageHeader title="概览" description="站点运营数据一览" />

      {error ? (
        <EmptyState title="加载失败" hint={error} />
      ) : !data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
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
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
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
