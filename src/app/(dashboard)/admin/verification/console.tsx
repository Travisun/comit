"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Check,
  Hourglass,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/primitives";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/admin/bits";
import { ConfirmDialog, RejectDialog } from "@/components/admin/post-actions";
import { api } from "@/components/admin/client";
import { timeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { tierLabel } from "@/lib/tiers";
import {
  VERIFICATION_BADGE_FALLBACK,
  VERIFICATION_BADGE_STYLES,
  VERIFICATION_TYPE_MAP,
  type AdminVerificationRequestView,
} from "@/lib/verification";
import { VerifiedBadge } from "@/components/user-space/verified-badge";

type TabKey = "pending" | "approved" | "rejected";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "pending", label: "待审", icon: <Hourglass /> },
  { key: "approved", label: "已通过", icon: <BadgeCheck /> },
  { key: "rejected", label: "已驳回", icon: <X /> },
];

/** 认证审核台：待审 / 已通过 / 已驳回 三个 Tab + 通过 / 驳回 / 撤销认证。 */
export function VerificationConsole() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [q, setQ] = useState("");
  const [kw, setKw] = useState("");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.icon}
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setKw(q.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索用户 / 认证名称"
            className="w-56 pl-8"
          />
        </form>
      </div>

      {TABS.map((t) => (
        <TabsContent key={t.key} value={t.key} className="outline-none">
          <RequestList status={t.key} q={kw} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function RequestList({ status, q }: { status: TabKey; q: string }) {
  const { locale } = useI18n();
  const [items, setItems] = useState<AdminVerificationRequestView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminVerificationRequestView | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminVerificationRequestView | null>(null);

  const load = useCallback(() => {
    api<{ items: AdminVerificationRequestView[]; total: number }>(
      `/api/admin/verification?status=${status}&limit=50&q=${encodeURIComponent(q)}`,
    )
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
      })
      .catch((err: Error) => setError(err.message));
  }, [status, q]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(
    id: string,
    action: "approve" | "reject" | "revoke",
    body?: Record<string, unknown>,
    done?: () => void,
  ) {
    setBusyId(id);
    try {
      await api(`/api/admin/verification/${id}/${action}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      toast.success(action === "approve" ? "已通过认证" : action === "reject" ? "已驳回" : "已撤销认证");
      done?.();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <EmptyState title="加载失败" hint={error} />;
  if (!items) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2.5 pt-5">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={status === "pending" ? "没有待审的认证申请" : "暂无记录"}
        hint={total > 0 ? "关键词不匹配？试试清空搜索" : undefined}
      />
    );
  }

  return (
    <>
      <div className="space-y-4">
        {items.map((item) => {
          const info = VERIFICATION_TYPE_MAP[item.type];
          const style = VERIFICATION_BADGE_STYLES[item.type] ?? VERIFICATION_BADGE_FALLBACK;
          return (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-3 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="size-10">
                      {item.user.avatarPath && (
                        <AvatarImage
                          src={`/api/media/file/${item.user.avatarPath}`}
                          alt={item.user.displayName}
                        />
                      )}
                      <AvatarFallback>{item.user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                        <span className="truncate">{item.user.displayName}</span>
                        <VerifiedBadge verified={item.user.verified} />
                        <Badge variant="outline">{tierLabel(item.user.tier)}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        @{item.user.username} · {timeAgo(item.createdAt, locale)}
                        {item.reviewedAt
                          ? ` · ${locale === "zh" ? "审核于" : "reviewed"} ${timeAgo(item.reviewedAt, locale)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.status === "pending" ? (
                      <>
                        <Button size="sm" disabled={busyId === item.id} onClick={() => void act(item.id, "approve")}>
                          <Check className="size-3.5" />
                          通过
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => setRejectTarget(item)}
                        >
                          <X className="size-3.5" />
                          驳回
                        </Button>
                      </>
                    ) : item.status === "approved" ? (
                      <>
                        <Badge variant="success">已通过</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => setRevokeTarget(item)}
                        >
                          <Undo2 className="size-3.5" />
                          撤销认证
                        </Button>
                      </>
                    ) : (
                      <Badge variant="destructive">已驳回</Badge>
                    )}
                  </div>
                </div>

                {/* 申请正文 */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`rounded-md border px-2 py-0.5 text-xs ${style.chip}`}>
                    {info ? info.name.zh : item.type}
                  </span>
                  <span className="font-medium">{item.label}</span>
                </div>
                <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-relaxed text-foreground/90">
                  {item.description}
                </p>

                {item.attachments.length > 0 && <AttachmentGrid attachments={item.attachments} />}
                {item.status === "rejected" && item.rejectReason ? (
                  <p className="text-xs text-muted-foreground">
                    驳回原因：<span className="text-foreground/80">{item.rejectReason}</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <RejectDialog
        open={rejectTarget !== null}
        onOpenChange={(v) => {
          if (!v) setRejectTarget(null);
        }}
        pending={busyId !== null}
        onSubmit={(reason) => {
          if (rejectTarget) void act(rejectTarget.id, "reject", { reason }, () => setRejectTarget(null));
        }}
      />
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(v) => {
          if (!v) setRevokeTarget(null);
        }}
        title="撤销该用户的认证？"
        description={
          revokeTarget
            ? `「${revokeTarget.user.displayName}」的 ${
                VERIFICATION_TYPE_MAP[revokeTarget.type]?.name.zh ?? revokeTarget.type
              } 认证徽章将立即失效，并通知用户。`
            : undefined
        }
        confirmText="撤销认证"
        destructive
        pending={busyId !== null}
        onConfirm={() => {
          if (revokeTarget) void act(revokeTarget.id, "revoke", undefined, () => setRevokeTarget(null));
        }}
      />
    </>
  );
}

/** 证明材料缩略图 + 点击放大查看。 */
function AttachmentGrid({ attachments }: { attachments: string[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((path) => (
          <button
            key={path}
            type="button"
            onClick={() => setPreview(path)}
            className="size-24 overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-80"
            aria-label="查看大图"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/file/${path}`} alt="证明材料" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>证明材料</DialogTitle>
            <DialogDescription>用户提交的认证附件</DialogDescription>
          </DialogHeader>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/file/${preview}`}
              alt="证明材料大图"
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
