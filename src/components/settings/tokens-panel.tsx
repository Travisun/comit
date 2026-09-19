"use client";

import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Loader2, Plus, Plug, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsPanelList, SettingsSectionHeader } from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { useApiMutation } from "@/lib/query/mutation";
import { queryKeys } from "@/lib/query/keys";
import { cn, formatDate, subscribeNoop } from "@/lib/utils";
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

/** 带一键复制的配置代码块。 */
function Snippet({ code, onCopy, copiedLabel, copyLabel }: {
  code: string;
  onCopy: () => void;
  copiedLabel: string;
  copyLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-12 font-mono text-xs leading-relaxed text-foreground">
        {code}
      </pre>
      <Button
        variant="outline"
        size="icon"
        className="absolute top-2 right-2"
        title={copyLabel}
        onClick={() => {
          onCopy();
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? <Check className="text-emerald-600" /> : <Copy />}
      </Button>
      <span className="sr-only">{copiedLabel}</span>
    </div>
  );
}

/**
 * MCP 接入面板：自适应端点 + 分客户端配置指南。
 * 端点主机名以「当前浏览器地址」为准（SSR 首帧用服务端 APP_URL 兜底避免
 * 水合抖动，挂载后切换为 window.location.origin）—— 反向代理域名、内网 IP、
 * 非标端口访问时，用户复制到的永远是当下可达的地址。
 */
export function McpPanel({ appUrl }: { appUrl: string }) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  // 端点主机名以「当前浏览器地址」为准：SSR/水合首帧用服务端 APP_URL，
  // 客户端侧 useSyncExternalStore 切换为 window.location.origin —— 反向代理
  // 域名、内网 IP、非标端口访问时，展示/复制的永远是当下可达的地址。
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => appUrl);
  const mcpEndpoint = `${origin}/api/mcp`;

  const copy = async (text: string) => {
    if (await copyText(text)) toast.success(t("common.copied"));
  };

  const tokenPlaceholder = zh ? "mbt_你的令牌" : "mbt_YOUR_TOKEN";
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        "comit.sh": {
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${tokenPlaceholder}` },
        },
      },
    },
    null,
    2,
  );
  const genericConfig = cursorConfig;
  const claudeCmd = `claude mcp add --transport http comit-sh ${mcpEndpoint} --header "Authorization: Bearer ${tokenPlaceholder}"`;

  return (
    <div className="space-y-4">
      <SettingsSectionHeader description={t("settings.tokens.desc")} />

      {/* 第 1 步：端点（自适应当前浏览器地址） */}
      <SettingsPanelList>
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm text-foreground">
                {zh ? "第 1 步 · MCP 端点" : "Step 1 · MCP endpoint"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {zh
                  ? "已自动适配当前浏览器访问的地址（协议/域名/端口）。通过自定义域名或内网访问时，无需手动改写。"
                  : "Automatically matches the address in your browser (protocol / host / port) — no manual rewriting needed behind proxies or on LAN."}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 pl-[26px]">
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
      </SettingsPanelList>

      {/* 第 2 步：创建令牌 */}
      <SettingsPanelList>
        <div className="flex items-start gap-2.5 px-4 py-3.5">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm text-foreground">
              {zh ? "第 2 步 · 创建 API 令牌" : "Step 2 · Create an API token"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {zh
                ? "在下方「API 令牌」区域创建一个令牌并复制（令牌仅显示一次）。建议按需勾选权限：只读接入勾读取类，需要 AI 帮你发文再勾 posts:write。"
                : "Create a token in the “API tokens” section below (shown only once). Grant scopes on demand: read-only scopes for browsing, plus posts:write only if the agent should publish for you."}
            </p>
          </div>
        </div>
      </SettingsPanelList>

      {/* 第 3 步：选择客户端复制配置 */}
      <SettingsPanelList>
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <SquareArrowOutUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm text-foreground">
                {zh ? "第 3 步 · 在客户端中配置" : "Step 3 · Configure your client"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {zh
                  ? "选择你使用的客户端，复制配置并粘贴；把 mbt_占位令牌 替换为第 2 步创建的真实令牌。"
                  : "Pick your client, paste the snippet, and replace the mbt_ placeholder with the real token from step 2."}
              </p>
            </div>
          </div>
          <div className="mt-3 pl-[26px]">
            <Tabs defaultValue="claude">
              <TabsList>
                <TabsTrigger value="claude">Claude</TabsTrigger>
                <TabsTrigger value="cursor">Cursor</TabsTrigger>
                <TabsTrigger value="generic">{zh ? "其他客户端" : "Other clients"}</TabsTrigger>
              </TabsList>
              <TabsContent value="claude" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {zh
                    ? "终端执行（Claude Code / Claude Desktop 均可）："
                    : "Run in a terminal (Claude Code / Claude Desktop):"}
                </p>
                <Snippet code={claudeCmd} onCopy={() => void copy(claudeCmd)} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
                <p className="text-xs text-muted-foreground">
                  {zh
                    ? "Claude Desktop 也可在 设置 → 连接器 → 添加自定义连接器 中粘贴端点，并选择「自定义鉴权」填入 Bearer 令牌。"
                    : "In Claude Desktop you can also add it under Settings → Connectors → Add custom connector, pasting the endpoint and a Bearer token."}
                </p>
              </TabsContent>
              <TabsContent value="cursor" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {zh
                    ? "粘贴到 Cursor 的 MCP 设置（~/.cursor/mcp.json 或 设置 → MCP）："
                    : "Paste into Cursor's MCP settings (~/.cursor/mcp.json or Settings → MCP):"}
                </p>
                <Snippet code={cursorConfig} onCopy={() => void copy(cursorConfig)} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
              </TabsContent>
              <TabsContent value="generic" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {zh
                    ? "任何支持 MCP Streamable HTTP 的客户端通用配置："
                    : "Generic config for any MCP client with Streamable HTTP support:"}
                </p>
                <Snippet code={genericConfig} onCopy={() => void copy(genericConfig)} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SettingsPanelList>
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["posts:read"]);
  const [created, setCreated] = useState<string | null>(null);

  // 令牌列表 — 服务端首屏作 initialData；创建/吊销后失效重取
  const tokensQ = useQuery({
    queryKey: queryKeys.tokens(),
    queryFn: async () => (await apiRequest<{ tokens: TokenView[] }>("/api/me/tokens", "GET")).tokens,
    initialData: initial,
  });
  const tokens = tokensQ.data ?? [];

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  // 创建令牌 — 成功弹一次性明文并失效列表（原「创建后裸 GET 回填」由
  // invalidate + useQuery 接管）；失败 toast 语义与原一致（err.message）
  const createMutation = useApiMutation(
    async (payload: { name: string; scopes: string[] }) => {
      const res = await apiRequest<{ id: string; token: string }>("/api/me/tokens", "POST", payload);
      if (!res?.token) throw new Error(t("common.error"));
      return res.token;
    },
    {
      refresh: false,
      invalidate: [queryKeys.tokens()],
      onSuccess: (token) => {
        setCreated(token);
        setOpen(false);
        setName("");
        setScopes(["posts:read"]);
      },
    },
  );

  // 吊销令牌 — 失效列表让 revokedAt 从服务端数据回流（原本地打点等价）
  const revokeMutation = useApiMutation((token: TokenView) => apiRequest(`/api/me/tokens/${token.id}`, "DELETE"), {
    refresh: false,
    invalidate: [queryKeys.tokens()],
  });

  function create() {
    if (createMutation.pending || !name.trim() || scopes.length === 0) return;
    void createMutation.mutate({ name: name.trim(), scopes });
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
        <ul className="divide-y divide-border rounded-lg border border-border">
          {tokens.map((tk) => {
            const revoked = Boolean(tk.revokedAt);
            return (
              <li
                key={tk.id}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3 transition-colors",
                  revoked ? "opacity-55" : "hover:bg-[var(--hover,#f7f8f8)]",
                )}
              >
                <div className="min-w-0 flex-1">
                  {/* 第一行：名称 + 状态 + 时间 meta */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                        revoked ? "bg-[var(--muted)] text-muted-foreground" : "bg-primary/[0.06] text-foreground",
                      )}
                    >
                      <KeyRound className="size-3.5" />
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">{tk.name}</span>
                    {revoked ? (
                      <Badge variant="destructive">{locale === "zh" ? "已吊销" : "Revoked"}</Badge>
                    ) : (
                      <Badge variant="success">{locale === "zh" ? "使用中" : "Active"}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {locale === "zh" ? "创建于" : "Created"} {formatDate(tk.createdAt, locale)}
                      {" · "}
                      {tk.lastUsedAt
                        ? `${locale === "zh" ? "最近使用" : "Last used"} ${formatDate(tk.lastUsedAt, locale)}`
                        : locale === "zh"
                          ? "从未使用"
                          : "Never used"}
                    </span>
                  </div>
                  {/* 第二行：令牌独占一行 + 权限徽章 */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8">
                    <code className="font-mono text-xs text-muted-foreground select-all">mbt_{tk.prefix}…</code>
                    <span className="flex flex-wrap items-center gap-1">
                      {tk.scopes.map((s) => (
                        <Badge key={s} variant="secondary">
                          {s}
                        </Badge>
                      ))}
                    </span>
                  </div>
                </div>
                {!revoked && (
                  <div className="shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      disabled={revokeMutation.pending}
                      onClick={() => void revokeMutation.mutate(tk)}
                    >
                      <Trash2 />
                      {t("settings.tokens.revoke")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
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
            <Button onClick={create} disabled={createMutation.pending || !name.trim() || scopes.length === 0}>
              {createMutation.pending && <Loader2 className="animate-spin" />}
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
