"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Award, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { BadgeChip } from "@/extensions/badges/badge-ui";
import { BADGE_ICON_KEYS, BADGE_ICON_LABELS, BADGE_STYLES } from "@/extensions/badges/styles";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiGet, deleteJson, requestSafe } from "@/lib/client/api";

interface BadgeRow {
  id: string;
  key: string;
  name: string;
  text: string;
  icon: string;
  style: string;
  description: string | null;
  enabled: boolean;
  grants: number;
}

interface Grant {
  userId: string;
  username: string;
  createdAt: string;
}

const ICON_OPTIONS = BADGE_ICON_KEYS.map((k) => ({ value: k, label: BADGE_ICON_LABELS[k] }));
const STYLE_OPTIONS = Object.entries(BADGE_STYLES).map(([value, v]) => ({ value, label: v.label }));

export function BadgesConsole() {
  const confirm = useConfirmDialog();
  const badgesQ = useQuery({
    queryKey: ["admin", "badges"],
    queryFn: async () => (await apiGet<{ badges: BadgeRow[] }>("/api/admin/badges")).badges,
  });
  const badges = badgesQ.data ?? [];

  async function removeBadge(b: BadgeRow) {
    const okToRemove = await confirm({
      title: `删除徽章「${b.name}」？`,
      description: "所有颁发与佩戴记录将一并移除。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!okToRemove) return;
    const r = await requestSafe(`/api/admin/badges/${b.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("已删除");
      badgesQ.refetch();
    } else {
      toast.error(r.error ?? "删除失败");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        徽章是荣誉头衔：后台颁发后，用户可在个人主页佩戴展示（最多 3 枚），并随其内容全站展示。
      </p>
      <BadgeCreator onCreated={() => badgesQ.refetch()} />
      {badgesQ.isLoading ? (
        <Loader2 className="animate-spin text-muted-foreground" />
      ) : (
        <ul className="space-y-3">
          {badges.map((b) => (
            <BadgeRowCard
              key={b.id}
              badge={b}
              confirm={confirm}
              onChanged={() => badgesQ.refetch()}
              onRemove={() => void removeBadge(b)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BadgeCreator({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    text: "",
    icon: "medal",
    style: "official",
    description: "",
  });
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!form.name.trim() || !form.text.trim()) {
      toast.error("名称与佩戴文字必填");
      return;
    }
    setBusy(true);
    const r = await requestSafe("/api/admin/badges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "创建失败");
      return;
    }
    toast.success("徽章已创建");
    setOpen(false);
    setForm({ name: "", text: "", icon: "medal", style: "official", description: "" });
    onCreated();
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        <Plus className="size-4" /> 新建徽章
      </Button>
      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>名称</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：年度贡献者" />
          </div>
          <div className="grid gap-1.5">
            <Label>佩戴文字（展示用短文字）</Label>
            <Input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="贡献者" />
          </div>
          <div className="grid gap-1.5">
            <Label>图标</Label>
            <select
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              className="h-[34px] rounded-md border border-border bg-card px-2 text-sm"
            >
              {ICON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>样式</Label>
            <select
              value={form.style}
              onChange={(e) => setForm({ ...form, style: e.target.value })}
              className="h-[34px] rounded-md border border-border bg-card px-2 text-sm"
            >
              {STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>说明</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="徽章含义（展示在主页提示中）"
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <BadgeChip badge={{ text: form.text || "预览", icon: form.icon, style: form.style }} size="md" />
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 创建徽章
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BadgeRowCard({
  badge,
  confirm,
  onChanged,
  onRemove,
}: {
  badge: BadgeRow;
  confirm: (opts: { title: string; description?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [showGrants, setShowGrants] = useState(false);
  const [grantUser, setGrantUser] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadGrants() {
    setBusy(true);
    try {
      const r = await apiGet<{ grants: Grant[] }>(`/api/admin/badges/${badge.id}/grants`);
      setGrants(r.grants);
      setShowGrants(true);
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    if (!grantUser.trim()) return;
    setBusy(true);
    const r = await requestSafe(`/api/admin/badges/${badge.id}/grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: grantUser.trim() }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "颁发失败");
      return;
    }
    toast.success(`已颁发给 @${grantUser.trim()}`);
    setGrantUser("");
    await loadGrants();
    onChanged();
  }

  async function revoke(userId: string, username: string) {
    const okToRemove = await confirm({
      title: `撤销 @${username} 的「${badge.name}」？`,
      danger: true,
      confirmLabel: "撤销",
    });
    if (!okToRemove) return;
    setBusy(true);
    const r = await requestSafe(`/api/admin/badges/${badge.id}/grants?userId=${userId}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) {
      toast.success("已撤销");
      await loadGrants();
    } else {
      toast.error(r.error ?? "撤销失败");
    }
  }

  async function toggleEnabled() {
    setBusy(true);
    const r = await requestSafe(`/api/admin/badges/${badge.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !badge.enabled }),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "操作失败");
      return;
    }
    onChanged();
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BadgeChip badge={badge} size="md" className={badge.enabled ? "" : "opacity-50 grayscale"} />
          <div className="text-xs text-muted-foreground">
            <span>{badge.description ?? badge.key}</span>
            <span className="ml-2">· {badge.grants} 人持有</span>
            {!badge.enabled && <span className="ml-2 text-destructive">已停用</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void toggleEnabled()} disabled={busy}>
            {badge.enabled ? "停用" : "启用"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() =>
              void confirm({
                title: `删除徽章「${badge.name}」？`,
                description: "所有颁发与佩戴记录将一并移除。",
                confirmLabel: "删除",
                danger: true,
              }).then((okToDelete) => {
                if (okToDelete) onRemove();
              })
            }
          >
            <Trash2 className="size-3.5" /> 删除
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Input
          value={grantUser}
          onChange={(e) => setGrantUser(e.target.value)}
          placeholder="用户名"
          className="h-8 w-40 text-xs"
        />
        <Button variant="outline" size="sm" onClick={() => void grant()} disabled={busy || !grantUser.trim()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Award className="size-3.5" />} 颁发
        </Button>
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => void loadGrants()}>
          {showGrants ? "刷新名单" : "查看颁发名单"}
        </Button>
        {showGrants && grants !== null && (
          <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {grants.length === 0
              ? "暂无持有者"
              : grants.map((g) => (
                  <span key={g.userId} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                    @{g.username}
                    <button
                      type="button"
                      aria-label={`撤销 @${g.username}`}
                      className="text-destructive hover:underline"
                      onClick={() => void revoke(g.userId, g.username)}
                      disabled={busy}
                    >
                      撤销
                    </button>
                  </span>
                ))}
          </span>
        )}
      </div>
    </li>
  );
}
