"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Switch } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { timeAgo } from "@/lib/utils";
import { apiRequest, copyText } from "./client";
import type { WebhookView } from "./types";

const EVENT_LABELS: Record<string, string> = {
  "post:published": "文章发布 / Post published",
  "post:liked": "文章获赞 / Post liked",
  "comment:created": "新评论 / New comment",
  "user:followed": "新关注 / New follower",
  "message:created": "新私信 / New message",
  "moderation:review.completed": "审核完成 / Review done",
  notification: "通知转发 / Notifications",
};

export function WebhooksPanel({
  initial,
  availableEvents,
}: {
  initial: WebhookView[];
  availableEvents: string[];
}) {
  const { t, locale } = useI18n();
  const [hooks, setHooks] = useState(initial);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["post:published"]);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await apiRequest<{ webhooks: WebhookView[] }>("/api/me/webhooks", "GET");
    setHooks(res.webhooks);
  }

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  async function create() {
    setBusy(true);
    try {
      const res = await apiRequest<{ webhook: { id: string; secret: string } }>(
        "/api/me/webhooks",
        "POST",
        { url: url.trim(), events },
      );
      setCreated(res.webhook);
      setOpen(false);
      setUrl("");
      setEvents(["post:published"]);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(hook: WebhookView) {
    try {
      await apiRequest(`/api/me/webhooks/${hook.id}`, "PATCH", { active: !hook.active });
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, active: !h.active } : h)));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function test(hook: WebhookView) {
    try {
      await apiRequest(`/api/me/webhooks/${hook.id}/test`, "POST", {});
      toast.success(
        locale === "zh" ? "测试事件已投递（异步）" : "Test delivery queued",
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove(hook: WebhookView) {
    if (!window.confirm(locale === "zh" ? "确定删除该 Webhook？" : "Delete this webhook?")) return;
    try {
      await apiRequest(`/api/me/webhooks/${hook.id}`, "DELETE");
      setHooks((prev) => prev.filter((h) => h.id !== hook.id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {hooks.length > 0 ? (
            <span className="rounded-full bg-[var(--selected)] px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {hooks.length}
            </span>
          ) : null}
          {t("settings.webhooks.desc")}
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus />
          {t("settings.webhooks.add")}
        </Button>
      </div>
      {hooks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {locale === "zh" ? "还没有 Webhook" : "No webhooks yet"}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {hooks.map((h) => (
            <li key={h.id} className="flex flex-col gap-2 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{h.url}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {h.events.map((ev) => (
                        <Badge key={ev} variant="secondary">
                          {ev}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("settings.webhooks.secret")}: <span className="font-mono">{h.secretPrefix}…</span>
                      {h.lastStatus !== null && (
                        <>
                          {" · "}
                          <span className={h.lastStatus < 400 ? "text-emerald-600" : "text-destructive"}>
                            HTTP {h.lastStatus}
                          </span>
                        </>
                      )}
                      {h.lastDeliveryAt && ` · ${timeAgo(h.lastDeliveryAt, locale)}`}
                      {h.failCount > 0 && ` · ${locale === "zh" ? "失败" : "failed"} ×${h.failCount}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch checked={h.active} onCheckedChange={() => void toggleActive(h)} />
                    <Button variant="outline" size="icon-sm" title={t("settings.webhooks.test")} onClick={() => void test(h)}>
                      <Send />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => void remove(h)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.webhooks.add")}</DialogTitle>
            <DialogDescription>{t("settings.webhooks.desc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="hookUrl">{t("settings.webhooks.url")}</Label>
              <Input
                id="hookUrl"
                value={url}
                placeholder="https://example.com/hooks/myblogs"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.webhooks.events")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableEvents.map((ev) => (
                  <label
                    key={ev}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5"
                      checked={events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    {EVENT_LABELS[ev] ?? ev}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={create} disabled={busy || !url.trim() || events.length === 0}>
              {busy && <Loader2 className="animate-spin" />}
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* one-time secret dialog */}
      <Dialog open={Boolean(created)} onOpenChange={(v) => !v && setCreated(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.webhooks.secret")}</DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? "请立即保存签名密钥，它不会再次显示。"
                : "Save this signing secret now — it will not be shown again."}
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-lg bg-[var(--muted)] p-3 font-mono text-sm">
            {created?.secret}
          </code>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (created && (await copyText(created.secret))) toast.success(t("common.copied"));
              }}
            >
              <Copy />
              {t("common.copy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
