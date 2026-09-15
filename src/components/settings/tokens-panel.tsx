"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsSectionHeader } from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { formatDate } from "@/lib/utils";
import { apiRequest, copyText } from "./client";
import type { TokenView } from "./types";

const SCOPE_LABELS: Record<string, string> = {
  "posts:read": "文章读取 / Read posts",
  "posts:write": "文章写入 / Write posts",
  "media:read": "媒体读取 / Read media",
  "media:write": "媒体写入 / Write media",
  "comments:read": "评论读取 / Read comments",
  "feed:read": "动态读取 / Read feed",
  "profile:read": "资料读取 / Read profile",
};

/** MCP 接入：端点地址 + 复制 / 打开。 */
export function McpPanel({ appUrl }: { appUrl: string }) {
  const { t } = useI18n();
  const mcpEndpoint = `${appUrl}/api/mcp`;

  return (
    <div className="space-y-4">
      <SettingsSectionHeader description={t("settings.tokens.desc")} />
      <div className="flex max-w-xl items-center gap-2">
        <Input readOnly value={mcpEndpoint} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          variant="outline"
          size="icon"
          title={t("common.copy")}
          onClick={async () => {
            if (await copyText(mcpEndpoint)) toast.success(t("common.copied"));
          }}
        >
          <Copy />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title={t("external.continue")}
          onClick={() => window.open(mcpEndpoint, "_blank")}
        >
          <SquareArrowOutUpRight />
        </Button>
      </div>
    </div>
  );
}

/** API 令牌：创建 / 吊销 / 列表。 */
export function ApiTokensPanel({
  initial,
  availableScopes,
}: {
  initial: TokenView[];
  availableScopes: string[];
}) {
  const { t, locale } = useI18n();
  const [tokens, setTokens] = useState(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["posts:read"]);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function create() {
    setBusy(true);
    try {
      const res = await apiRequest<{ id: string; token: string }>("/api/me/tokens", "POST", {
        name: name.trim(),
        scopes,
      });
      setCreated(res.token);
      setOpen(false);
      setName("");
      setScopes(["posts:read"]);
      const list = await apiRequest<{ tokens: TokenView[] }>("/api/me/tokens", "GET");
      setTokens(list.tokens);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: TokenView) {
    try {
      await apiRequest(`/api/me/tokens/${token.id}`, "DELETE");
      setTokens((prev) => prev.map((x) => (x.id === token.id ? { ...x, revokedAt: new Date().toISOString() } : x)));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{locale === "zh" ? "用于 MCP 或 REST 访问" : "For MCP / REST access"}</p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus />
          {t("settings.tokens.create")}
        </Button>
      </div>
      {tokens.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {locale === "zh" ? "还没有令牌" : "No tokens yet"}
        </p>
      ) : (
        <ul className="flex flex-col gap-y-1">
          {tokens.map((tk) => (
            <li key={tk.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 -mx-2 py-3 transition-colors hover:bg-[var(--hover,#f7f8f8)]">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-4 text-muted-foreground" />
                  {tk.name}
                  <span className="font-mono text-xs text-muted-foreground">mbt_{tk.prefix}…</span>
                  {tk.revokedAt && <Badge variant="destructive">{locale === "zh" ? "已吊销" : "Revoked"}</Badge>}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {tk.scopes.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {locale === "zh" ? "创建于" : "Created"} {formatDate(tk.createdAt, locale)}
                  {tk.lastUsedAt
                    ? ` · ${locale === "zh" ? "最近使用" : "last used"} ${formatDate(tk.lastUsedAt, locale)}`
                    : ` · ${locale === "zh" ? "从未使用" : "never used"}`}
                </p>
              </div>
              {!tk.revokedAt && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void revoke(tk)}>
                  <Trash2 />
                  {t("settings.tokens.revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.tokens.create")}</DialogTitle>
            <DialogDescription>{t("settings.tokens.desc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tokenName">{t("settings.tokens.name")}</Label>
              <Input
                id="tokenName"
                value={name}
                placeholder={locale === "zh" ? "例如：Claude / Cursor" : "e.g. Claude / Cursor"}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("settings.tokens.scopes")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableScopes.map((s) => (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5"
                      checked={scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                    />
                    {SCOPE_LABELS[s] ?? s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={create} disabled={busy || !name.trim() || scopes.length === 0}>
              {busy && <Loader2 className="animate-spin" />}
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* one-time token dialog */}
      <Dialog open={Boolean(created)} onOpenChange={(v) => !v && setCreated(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === "zh" ? "令牌已创建" : "Token created"}</DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? "完整令牌仅显示这一次，请立即复制保存。"
                : "The full token is shown only once — copy it now."}
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-lg bg-muted p-3 font-mono text-sm">{created}</code>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (created && (await copyText(created))) toast.success(t("common.copied"));
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
