"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  MessageSquareWarning,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Timer,
  User,
  UserCog,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EmptyState,
  FilterChips,
  PageHeader,
  Pagination,
  RoleBadge,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/bits";
import {
  ADMIN_USERS_KEY_PREFIX,
  PermanentBanDialog,
  TimedBanDialog,
  WarnDialog,
  useUserModerationMutation,
  type ModalityTarget,
} from "@/components/admin/user-modals";
import { useApiMutation, useQueryClient } from "@/lib/query/mutation";
import { apiQueryOptions } from "@/lib/query/options";
import { patchJson } from "@/lib/client/api";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

// 就地 zod schema：/api/admin/users 响应无现成 schema，进缓存前校验把关
const userItemSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarPath: z.string().nullable(),
  /** widened to include "editor" for forward-compat with the permissions model */
  role: z.enum(["user", "admin", "editor"]),
  status: z.enum(["active", "suspended", "deleted"]),
  email: z.string(),
  tier: z.number(),
  verified: z
    .object({ type: z.string(), label: z.string(), approvedAt: z.string() })
    .nullable(),
  bannedUntil: z.string().nullable(),
  banReason: z.string().nullable(),
  isBanned: z.boolean(),
  postCount: z.number(),
  createdAt: z.string(),
});

const usersListSchema = z.object({
  items: z.array(userItemSchema),
  total: z.number(),
});

type UserItem = z.infer<typeof userItemSchema>;

const PAGE_SIZE = 25;

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "active", label: "正常" },
  { value: "banned", label: "封禁中" },
  { value: "editor", label: "编辑" },
  { value: "admin", label: "管理员" },
] as const;

/** Format a ban expiry for tooltips. */
function formatUntil(iso: string, locale: "zh" | "en"): string {
  return new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Status cell: 正常 / 限时封禁(剩 X 天 + tooltip) / 永久封禁 / 已到期待解封. */
function BanStateCell({ u }: { u: UserItem }) {
  const { locale } = useI18n();
  if (u.status === "active") return <Badge variant="success">正常</Badge>;
  if (u.status === "deleted") return <Badge variant="secondary">已注销</Badge>;
  if (!u.bannedUntil) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive">永久封禁</Badge>
        </TooltipTrigger>
        {u.banReason ? (
          <TooltipContent className="max-w-64 whitespace-normal">
            原因：{u.banReason}
          </TooltipContent>
        ) : null}
      </Tooltip>
    );
  }
  const until = new Date(u.bannedUntil);
  if (until.getTime() <= Date.now()) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-warning">
            已到期待解封
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 whitespace-normal">
          封禁已于 {formatUntil(u.bannedUntil, locale)} 到期；用户下次登录时自动解封，或点此行的「解封」立即恢复。
        </TooltipContent>
      </Tooltip>
    );
  }
  const days = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 86400_000));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="warning">限时封禁 · 剩 {days} 天</Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 whitespace-normal">
        解封时间：{formatUntil(u.bannedUntil, locale)}
        {u.banReason ? (
          <>
            <br />
            原因：{u.banReason}
          </>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export default function AdminUsersPage() {
  const { locale } = useI18n();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [warnTarget, setWarnTarget] = useState<UserItem | null>(null);
  const [timedTarget, setTimedTarget] = useState<UserItem | null>(null);
  const [permTarget, setPermTarget] = useState<UserItem | null>(null);

  // 搜索防抖：qInput → query（驱动 queryKey 重查）；新搜索词重置分页
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  // 列表查询 — key 随筛选/搜索/分页变化天然隔离（原 remount-by-key 防竞态
  // hack 已删）；placeholderData 让切换筛选时保留上一页数据不闪空
  const usersQ = useQuery(
    apiQueryOptions({
      queryKey: [...ADMIN_USERS_KEY_PREFIX, filter, query, offset],
      url: `/api/admin/users?${new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(query ? { q: query } : {}),
        ...(filter !== "all" ? { filter } : {}),
      })}`,
      schema: usersListSchema,
      placeholderData: keepPreviousData,
    }),
  );
  const items = useMemo(() => usersQ.data?.items ?? [], [usersQ.data]);
  const total = usersQ.data?.total ?? 0;

  // 到期未解封账号（当前页）—「一键恢复」的输入；以数据快照时间
  // （dataUpdatedAt）为「当前时间」锚点，保持渲染纯度且随数据刷新而更新
  const snapshotNow = usersQ.dataUpdatedAt;
  const expiredIds = items
    .filter(
      (u) =>
        u.status === "suspended" &&
        u.bannedUntil &&
        new Date(u.bannedUntil).getTime() <= snapshotNow,
    )
    .map((u) => u.id);

  // 单用户处置（解封/角色/警告/封禁）— 成功后失效用户列表缓存；错误 toast
  // 由统一封装给出（文案与原 toastError 一致），成功提示随动作动态拼
  const moderation = useUserModerationMutation((input) =>
    toast.success(input.successMessage),
  );

  async function runUserAction(user: UserItem, patch: Record<string, unknown>, success: string) {
    setPendingId(user.id);
    // mutate 失败不抛出（错误 toast 已由统一封装兜底）
    await moderation.mutate({ userId: user.id, patch, successMessage: success });
    setPendingId(null);
  }

  const queryClient = useQueryClient();
  // 一键恢复到期账号：逐个静默提交（失败跳过、不弹错），结束后统一失效
  // 一次列表 — 等价于原实现的批量 PATCH + 单次 reload
  const restoreBatch = useApiMutation(
    (userId: string) => patchJson(`/api/admin/users/${userId}`, { action: "unban" }),
    { refresh: false, silent: true },
  );

  async function restoreExpired() {
    if (expiredIds.length === 0 || restoreBatch.pending) return;
    let okCount = 0;
    for (const id of expiredIds) {
      if ((await restoreBatch.mutate(id)) !== undefined) okCount += 1;
    }
    toast.success(`已恢复 ${okCount} 个到期账号`);
    void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY_PREFIX });
  }

  const onPage = (next: number) => setOffset(next);

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="角色、警告、限时/永久封禁与账号状态管理"
        actions={
          expiredIds.length > 0 ? (
            <Button variant="outline" size="sm" onClick={restoreExpired} disabled={restoreBatch.pending}>
              <RotateCcw />
              {restoreBatch.pending ? "恢复中…" : `一键恢复已到期 (${expiredIds.length})`}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索用户名 / 昵称 / 邮箱…"
            className="pl-8"
          />
        </div>
        <div className="flex gap-1.5">
          <FilterChips options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} value={filter} onChange={(v) => { setFilter(v); setOffset(0); }} />
        </div>
      </div>

      {usersQ.error ? (
        <EmptyState title="加载失败" hint={usersQ.error.message} />
      ) : usersQ.isPending ? (
        <TableSkeleton rows={8} cols={6} />
      ) : items.length === 0 ? (
        <EmptyState title="没有匹配的用户" hint="试试其他筛选或搜索词" />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th>用户</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th className="text-right">文章数</th>
                <th className="text-right">注册时间</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <a
                      href={`/u/${u.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 hover:underline"
                    >
                      <Avatar className="size-8">
                        {u.avatarPath ? <AvatarImage src={`/api/media/file/${u.avatarPath}`} /> : null}
                        <AvatarFallback>{u.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{u.displayName}</span>
                          {u.verified ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              {u.verified.label}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">@{u.username}</span>
                      </span>
                    </a>
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">{u.email}</td>
                  <td>
                    <RoleBadge role={u.role} />
                  </td>
                  <td>
                    <BanStateCell u={u} />
                  </td>
                  <td className="text-right tabular-nums">{u.postCount}</td>
                  <td className="whitespace-nowrap text-right text-xs text-muted-foreground">
                    {timeAgo(u.createdAt, locale)}
                  </td>
                  <td className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={pendingId === u.id}
                          aria-label="更多操作"
                        >
                          <UserCog className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onSelect={() => setWarnTarget(u)}>
                          <MessageSquareWarning />
                          警告…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setTimedTarget(u)}>
                          <Timer />
                          限时封禁…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setPermTarget(u)}
                        >
                          <ShieldAlert />
                          永久封禁…
                        </DropdownMenuItem>
                        {u.status === "suspended" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              void runUserAction(u, { action: "unban" }, `已解封 @${u.username}`)
                            }
                          >
                            <UserRoundCheck />
                            解封
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        {u.role !== "admin" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              void runUserAction(u, { role: "admin" }, `已将 @${u.username} 设为管理员`)
                            }
                          >
                            <ShieldCheck />
                            设为管理员
                          </DropdownMenuItem>
                        ) : null}
                        {u.role !== "editor" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              void runUserAction(u, { role: "editor" }, `已将 @${u.username} 设为编辑`)
                            }
                          >
                            <ShieldOff />
                            设为编辑
                          </DropdownMenuItem>
                        ) : null}
                        {u.role !== "user" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              void runUserAction(u, { role: "user" }, `已将 @${u.username} 设为普通用户`)
                            }
                          >
                            <User />
                            设为普通用户
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination offset={offset} limit={PAGE_SIZE} total={total} onPage={onPage} />

          <WarnDialog
            target={warnTarget as ModalityTarget | null}
            open={warnTarget !== null}
            onOpenChange={(v) => {
              if (!v) setWarnTarget(null);
            }}
            pending={false}
            onSubmit={async (message) => {
              const t = warnTarget;
              if (!t) return;
              setWarnTarget(null);
              await runUserAction(t, { action: "warn", message }, `已向 @${t.username} 发送警告`);
            }}
          />
          <TimedBanDialog
            target={timedTarget as ModalityTarget | null}
            open={timedTarget !== null}
            onOpenChange={(v) => {
              if (!v) setTimedTarget(null);
            }}
            pending={false}
            onSubmit={async (days, reason) => {
              const t = timedTarget;
              if (!t) return;
              setTimedTarget(null);
              await runUserAction(
                t,
                { action: "ban_timed", days, reason },
                `已封禁 @${t.username} ${days} 天`,
              );
            }}
          />
          <PermanentBanDialog
            target={permTarget as ModalityTarget | null}
            open={permTarget !== null}
            onOpenChange={(v) => {
              if (!v) setPermTarget(null);
            }}
            pending={false}
            onSubmit={async (reason) => {
              const t = permTarget;
              if (!t) return;
              setPermTarget(null);
              await runUserAction(t, { action: "ban_permanent", reason }, `已永久封禁 @${t.username}`);
            }}
          />
        </>
      )}
    </div>
  );
}
