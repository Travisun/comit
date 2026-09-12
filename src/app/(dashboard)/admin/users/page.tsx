"use client";

import { useCallback, useEffect, useState } from "react";
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
  PermanentBanDialog,
  TimedBanDialog,
  WarnDialog,
  toastError,
  type ModalityTarget,
} from "@/components/admin/user-modals";
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface UserItem {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  /** widened to include "editor" for forward-compat with the permissions model */
  role: "user" | "admin" | "editor";
  status: "active" | "suspended" | "deleted";
  email: string;
  tier: number;
  verified: { type: string; label: string; approvedAt: string } | null;
  bannedUntil: string | null;
  banReason: string | null;
  isBanned: boolean;
  postCount: number;
  createdAt: string;
}

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

/** Fetches and renders one page of users; remounted (via key) on query change. */
function UserList({
  query,
  filter,
  offset,
  onPage,
  onChanged,
  onExpiredLoaded,
}: {
  query: string;
  filter: string;
  offset: number;
  onPage: (next: number) => void;
  onChanged: () => void;
  onExpiredLoaded: (usernames: string[]) => void;
}) {
  const { locale } = useI18n();
  const [data, setData] = useState<{ items: UserItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [warnTarget, setWarnTarget] = useState<UserItem | null>(null);
  const [timedTarget, setTimedTarget] = useState<UserItem | null>(null);
  const [permTarget, setPermTarget] = useState<UserItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (query) params.set("q", query);
    if (filter !== "all") params.set("filter", filter);
    api<{ items: UserItem[]; total: number }>(`/api/admin/users?${params}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        onExpiredLoaded(
          d.items
            .filter(
              (u) =>
                u.status === "suspended" &&
                u.bannedUntil &&
                new Date(u.bannedUntil).getTime() <= Date.now(),
            )
            .map((u) => u.id),
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [query, filter, offset, onChanged, onExpiredLoaded]);

  async function patchUser(user: UserItem, patch: Record<string, unknown>, success: string) {
    setPendingId(user.id);
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      toast.success(success);
      onChanged();
    } catch (err) {
      toastError(err);
    } finally {
      setPendingId(null);
    }
  }

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!data) return <TableSkeleton rows={8} cols={6} />;
  if (data.items.length === 0) return <EmptyState title="没有匹配的用户" hint="试试其他筛选或搜索词" />;

  return (
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
          {data.items.map((u) => (
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
                        onSelect={() => patchUser(u, { action: "unban" }, `已解封 @${u.username}`)}
                      >
                        <UserRoundCheck />
                        解封
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    {u.role !== "admin" ? (
                      <DropdownMenuItem
                        onSelect={() => patchUser(u, { role: "admin" }, `已将 @${u.username} 设为管理员`)}
                      >
                        <ShieldCheck />
                        设为管理员
                      </DropdownMenuItem>
                    ) : null}
                    {u.role !== "editor" ? (
                      <DropdownMenuItem
                        onSelect={() => patchUser(u, { role: "editor" }, `已将 @${u.username} 设为编辑`)}
                      >
                        <ShieldOff />
                        设为编辑
                      </DropdownMenuItem>
                    ) : null}
                    {u.role !== "user" ? (
                      <DropdownMenuItem
                        onSelect={() => patchUser(u, { role: "user" }, `已将 @${u.username} 设为普通用户`)}
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
      <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onPage={onPage} />

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
          await patchUser(t, { action: "warn", message }, `已向 @${t.username} 发送警告`);
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
          await patchUser(
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
          await patchUser(t, { action: "ban_permanent", reason }, `已永久封禁 @${t.username}`);
        }}
      />
    </>
  );
}

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [expiredIds, setExpiredIds] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [q]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const onPage = useCallback((next: number) => setOffset(next), []);
  const onExpiredLoaded = useCallback((ids: string[]) => setExpiredIds(ids), []);

  /** One-click restore: unban every expired timed-ban on the current page. */
  async function restoreExpired() {
    if (expiredIds.length === 0 || restoring) return;
    setRestoring(true);
    let okCount = 0;
    for (const id of expiredIds) {
      try {
        await api(`/api/admin/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "unban" }),
        });
        okCount += 1;
      } catch {
        /* keep going; failures stay suspended */
      }
    }
    setRestoring(false);
    toast.success(`已恢复 ${okCount} 个到期账号`);
    bump();
  }

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="角色、警告、限时/永久封禁与账号状态管理"
        actions={
          expiredIds.length > 0 ? (
            <Button variant="outline" size="sm" onClick={restoreExpired} disabled={restoring}>
              <RotateCcw />
              {restoring ? "恢复中…" : `一键恢复已到期 (${expiredIds.length})`}
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

      <UserList
        key={`${query}|${filter}|${offset}|${version}`}
        query={query}
        filter={filter}
        offset={offset}
        onPage={onPage}
        onChanged={bump}
        onExpiredLoaded={onExpiredLoaded}
      />
    </div>
  );
}
