"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/primitives";
import {
  Notice,
  SectionTabs,
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { EmptyState, OverrideBadge, PageHeader } from "@/components/admin/bits";
import { LlmProvidersPanel } from "@/components/admin/llm-providers-panel";
import { OAuthProvidersSection, SmtpSection } from "@/components/admin/oauth-smtp-panels";
import { Field, SwitchRow } from "@/components/admin/switch-row";
import { useI18n } from "@/lib/i18n/client";
import { postJson } from "@/lib/client/api";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { useQueryClient } from "@tanstack/react-query";
import { EXTENSION_MANIFESTS } from "@/extensions/_boot/manifests";
import { useApiMutation } from "@/lib/query/mutation";
// 桶清单单源：bucket-manifest.ts 是纯数据零 import 的客户端安全模块，
// 运行时导入不会把服务端依赖（@/db → pg）拖进浏览器包
import { RATE_BUCKETS } from "@/lib/rate-limit/bucket-manifest";
// 仅类型导入（编译期擦除）— buckets.ts 顶层依赖 @/db（服务端），运行时不可导入
import type { BucketOverrides } from "@/lib/rate-limit/buckets";

type Switches = Record<string, boolean>;

/* ------------------------- rate-limit buckets 区块 ------------------------- */

/** `ratelimit.buckets` 设置键 — 仅存覆盖项，缺省桶走 RATE_BUCKETS 内置默认 */
type BucketDraft = { limit: string; windowSec: string };

/** 服务端 zod 边界（前端同值拦截，避免无效请求） */
const BUCKET_LIMIT_MAX = 100_000;
const BUCKET_WINDOW_MAX = 86_400;

const EMPTY_DRAFT: BucketDraft = { limit: "", windowSec: "" };

/** GET entries 里该键的运行时校验 — 坏数据降级为「全部默认」而非崩渲染 */
const bucketOverridesSchema = z.record(
  z.string(),
  z.object({ limit: z.number(), windowSec: z.number() }),
);

/* -------------------------------- schema --------------------------------- */

const adminSettingsSchema = z.object({
  entries: z.record(z.string(), z.unknown()),
  oauthEnv: z.record(z.string(), z.boolean()).optional(),
});

type AdminSettingsData = z.infer<typeof adminSettingsSchema>;

const suggestSchema = z.object({
  items: z.array(z.object({ username: z.string(), displayName: z.string() })),
});

const FEATURE_KEYS: { key: string; label: string; desc: string }[] = [
  { key: "site.registrationOpen", label: "开放注册", desc: "关闭后新用户将无法注册" },
  {
    key: "auth.passwordAuth",
    label: "账号密码登录与注册",
    desc: "关闭后仅允许第三方（OSS）登录与注册，登录页/注册页/登录弹窗隐藏邮箱表单",
  },
  { key: "verification.enabled", label: "认证功能", desc: "关闭后前台隐藏认证入口（管理端审核台保留）" },
  { key: "site.inviteRequired", label: "注册需要邀请码", desc: "仅持有有效邀请码的用户可完成注册" },
  { key: "site.force2fa", label: "强制两步验证", desc: "所有用户登录时必须完成 TOTP 验证" },
];

const SSO_KEYS: { key: string; label: string }[] = [
  { key: "sso.github", label: "GitHub" },
  { key: "sso.google", label: "Google" },
  { key: "sso.x", label: "X (Twitter)" },
  { key: "sso.discourse", label: "Discourse" },
  { key: "sso.cfaccess", label: "Cloudflare Access" },
  { key: "sso.linuxdo", label: "Linux.do" },
];

type AdminTab = "general" | "mode" | "features" | "login" | "ratelimit" | "llm" | "exts";

export default function AdminSettingsPage() {
  // 设置查询 — 表单为 keyed 子组件：data 版本变化（首次到达/保存失效重取）时
  // 以服务端权威值重新播种，等价原 load 回调里的逐字段赋值
  const settingsQ = useQuery(
    apiQueryOptions({
      queryKey: queryKeys.adminSettings(),
      url: "/api/admin/settings",
      schema: adminSettingsSchema,
    }),
  );
  const loading = settingsQ.isLoading;
  const error = settingsQ.error instanceof Error ? settingsQ.error.message : null;

  // tab 态留在父层且必须在早退分支前初始化：保存失效 → 表单按 dataUpdatedAt
  // 重播种 remount，提升后当前标签不丢
  const [tab, setTab] = useState<AdminTab>("general");

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="站点设置" description="站点信息、模式与功能开关" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (error && !settingsQ.data) {
    return (
      <div>
        <PageHeader title="站点设置" description="站点信息、模式与功能开关" />
        <EmptyState title="加载失败" hint={error} />
      </div>
    );
  }

  if (!settingsQ.data) return null;

  return <AdminSettingsForm key={settingsQ.dataUpdatedAt} seed={settingsQ.data} tab={tab} onTabChange={setTab} />;
}

/** 表单体 — 全部编辑态从 seed 初始化（不再用 effect 同步）。 */
function AdminSettingsForm({
  seed,
  tab,
  onTabChange,
}: {
  seed: AdminSettingsData;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}) {
  const { t } = useI18n();
  // 登录凭证的只读状态（configured 等）— 来自 GET entries（已合并 env 判定）
  const oauthProviders = (seed.entries["oauth.providers"] ?? {}) as Record<
    string,
    { clientId: string; hasSecret: boolean; configured: boolean }
  >;
  const [name, setName] = useState(String(seed.entries["site.name"] ?? ""));
  const [tagline, setTagline] = useState(String(seed.entries["site.tagline"] ?? ""));
  const [description, setDescription] = useState(String(seed.entries["site.description"] ?? ""));
  const [keywords, setKeywords] = useState(String(seed.entries["site.keywords"] ?? ""));
  const [ogImage, setOgImage] = useState(String(seed.entries["site.ogImage"] ?? ""));
  const [twitter, setTwitter] = useState(String(seed.entries["site.twitter"] ?? ""));
  const [copyright, setCopyright] = useState(String(seed.entries["site.copyright"] ?? ""));
  const [beian, setBeian] = useState(String(seed.entries["site.beian"] ?? ""));
  const [noindex, setNoindex] = useState(Boolean(seed.entries["site.noindex"]));
  const [mode, setMode] = useState<"multi" | "single">(
    seed.entries["site.mode"] === "single" ? "single" : "multi",
  );
  const [singleUser, setSingleUser] = useState(String(seed.entries["site.singleUser"] ?? ""));
  const [switches, setSwitches] = useState<Switches>(() => {
    const next: Switches = {};
    for (const k of [...FEATURE_KEYS, ...SSO_KEYS].map((k) => k.key)) {
      next[k] = Boolean(seed.entries[k]);
    }
    next["notify.emailEnabled"] = Boolean(seed.entries["notify.emailEnabled"]);
    next["auth.passkeys"] = Boolean(seed.entries["auth.passkeys"]);
    return next;
  });

  // 保存设置 — pending 驱动按钮；成功失效设置键（重取 + 表单重播种）
  const saveMutation = useApiMutation(
    (payload: { entries: Record<string, unknown> }) => postJson("/api/admin/settings", payload),
    {
      refresh: false,
      invalidate: [queryKeys.adminSettings()],
      successToast: "设置已保存",
    },
  );

  // debounced username suggestions for single-user mode（q 进 queryKey）
  const [suggestQ, setSuggestQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSuggestQ(singleUser.trim()), 300);
    return () => clearTimeout(timer);
  }, [singleUser]);

  const suggestionsQ = useQuery({
    ...apiQueryOptions({
      queryKey: queryKeys.adminSettingsSuggest(suggestQ),
      url: `/api/admin/users?q=${encodeURIComponent(suggestQ)}&limit=8`,
      schema: suggestSchema,
    }),
    enabled: mode === "single" && suggestQ.length > 0,
  });
  const suggestions = suggestionsQ.data?.items ?? [];

  function save() {
    void saveMutation.mutate({
      entries: {
        "site.name": name.trim(),
        "site.tagline": tagline.trim(),
        "site.description": description.trim(),
        "site.keywords": keywords.trim(),
        "site.ogImage": ogImage.trim(),
        "site.twitter": twitter.trim().replace(/^@+/, ""),
        "site.copyright": copyright.trim(),
        "site.beian": beian.trim(),
        "site.noindex": noindex,
        "site.mode": mode,
        "site.singleUser": singleUser.trim(),
        ...Object.fromEntries(FEATURE_KEYS.map((k) => [k.key, switches[k.key] ?? false])),
        ...Object.fromEntries(SSO_KEYS.map((k) => [k.key, switches[k.key] ?? false])),
        "notify.emailEnabled": switches["notify.emailEnabled"] ?? false,
        "auth.passkeys": switches["auth.passkeys"] ?? false,
      },
    });
  }

  return (
    <div>
      <PageHeader
        title="站点设置"
        description="站点信息、模式与功能开关"
        actions={
          <Button onClick={save} disabled={saveMutation.pending}>
            <Save className="size-4" />
            {saveMutation.pending ? "保存中…" : "保存设置"}
          </Button>
        }
      />

      <SectionTabs
        value={tab}
        onChange={(id) => onTabChange(id as AdminTab)}
        tabs={[
          { id: "general", label: "常规" },
          { id: "mode", label: "用户模式" },
          { id: "features", label: "功能开关" },
          { id: "login", label: "登录" },
          { id: "ratelimit", label: "频率限制" },
          { id: "llm", label: "AI 模型" },
          { id: "exts", label: "扩展" },
        ]}
      />

      {tab === "general" && (
        <>
          <SettingsSection className="max-w-2xl">
            <SettingsSectionHeader
              title="品牌信息"
              description="站点对外展示的基本信息 —— 全站标题、登录页、页脚、RSS、PWA 即时生效"
            />
            <div className="grid gap-4">
              <Field label="站点名称">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="comit.sh" maxLength={60} />
              </Field>
              <Field label="副标题" hint="展示于浏览器标题与 PWA 名称（按破折号取首段）">
                <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} />
              </Field>
              <Field label="站点描述" hint="SEO description 与站点简介（RSS / manifest 共用）">
                <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection className="max-w-2xl">
            <SettingsSectionHeader
              title="SEO"
              description="搜索引擎与社交分享（OG / Twitter Card）元信息"
            />
            <div className="grid gap-4">
              <Field label="关键词" hint="英文/中文逗号分隔，最多 20 个；留空不下发">
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="科研日志, 技术博客, 个人品牌"
                  maxLength={500}
                />
              </Field>
              <Field label="默认分享图（OG Image）" hint="站内媒体相对路径或完整 https URL；分享到社交平台时的大图">
                <Input
                  value={ogImage}
                  onChange={(e) => setOgImage(e.target.value)}
                  placeholder="media/og-cover.webp 或 https://…"
                  maxLength={2048}
                />
              </Field>
              <Field label="Twitter 句柄" hint="twitter:site，带或不带 @ 均可；留空不下发">
                <Input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@yourteam" maxLength={30} />
              </Field>
              <SwitchRow
                label="全站禁止搜索引擎收录"
                description="私有实例用：robots.txt 全站 Disallow + 页面 noindex"
                checked={noindex}
                onCheckedChange={setNoindex}
              />
            </div>
          </SettingsSection>

          <SettingsSection className="max-w-2xl">
            <SettingsSectionHeader
              title="版权与合规"
              description="页脚版权行与备案信息（桌面右栏与移动端页脚同步）"
            />
            <div className="grid gap-4">
              <Field label="版权信息" hint="留空使用默认「© 年份 站点名称」">
                <Input
                  value={copyright}
                  onChange={(e) => setCopyright(e.target.value)}
                  placeholder={`© ${new Date().getFullYear()} ${name.trim() || "comit.sh"}`}
                  maxLength={200}
                />
              </Field>
              <Field label="ICP 备案号" hint="显示在页脚并链接工信部备案系统；留空不显示">
                <Input value={beian} onChange={(e) => setBeian(e.target.value)} placeholder="京ICP备XXXXXXXX号" maxLength={100} />
              </Field>
            </div>
          </SettingsSection>
        </>
      )}

      {tab === "mode" && (
        <SettingsSection className="max-w-2xl">
          <SettingsSectionHeader description={t("admin.settings.modeHint")} />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { value: "multi", title: "多用户社区", desc: "首页展示社区信息流，用户各自拥有空间" },
                { value: "single", title: "单用户博客", desc: "首页即为指定用户的个人博客" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                aria-pressed={mode === opt.value}
                className={
                  mode === opt.value
                    ? "flex flex-col items-start gap-1 rounded-md border border-primary bg-[color-mix(in_srgb,var(--primary)_5%,transparent)] p-3 text-left"
                    : "flex flex-col items-start gap-1 rounded-md border border-border p-3 text-left transition-colors hover:bg-[var(--hover)]"
                }
              >
                <span className="text-sm font-semibold">{opt.title}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
            {mode === "single" ? (
              <div className="sm:col-span-2">
                <Field label="单用户账号" hint="输入用户名，从联想列表中选择">
                  <Input
                    value={singleUser}
                    onChange={(e) => setSingleUser(e.target.value)}
                    list="admin-single-user-options"
                    placeholder="username"
                    autoComplete="off"
                  />
                  <datalist id="admin-single-user-options">
                    {suggestions.map((s) => (
                      <option key={s.username} value={s.username}>
                        {s.displayName}
                      </option>
                    ))}
                  </datalist>
                </Field>
              </div>
            ) : null}
          </div>
          <SettingsFooter hint="更改站点模式会立即改变首页形态。">
            <Button onClick={save} disabled={saveMutation.pending}>
              <Save className="size-4" />
              {saveMutation.pending ? "保存中…" : "保存设置"}
            </Button>
          </SettingsFooter>
        </SettingsSection>
      )}

      {tab === "features" && (
        <SettingsSection>
          <SettingsSectionHeader description="控制注册、域名与安全相关能力" />
          <div>
            {FEATURE_KEYS.map((k, i) => (
              <SwitchRow
                key={k.key}
                label={k.label}
                description={k.desc}
                checked={switches[k.key] ?? false}
                onCheckedChange={(v) => setSwitches((s) => ({ ...s, [k.key]: v }))}
                last={i === FEATURE_KEYS.length - 1}
              />
            ))}
          </div>
        </SettingsSection>
      )}

      {tab === "login" && (
        <div className="space-y-6">
          <SettingsSection className="max-w-2xl">
            <SettingsSectionHeader description="第三方登录的启停开关；凭证在下方面板配置（数据库优先，环境变量兜底）。" />
            <div>
              {SSO_KEYS.map((k) => {
                const configured =
                  oauthProviders[k.key.replace("sso.", "")]?.configured ?? false;
                return (
                  <SwitchRow
                    key={k.key}
                    label={`${k.label}（${configured ? "凭证已就绪" : "未配置凭证"}）`}
                    checked={switches[k.key] ?? false}
                    onCheckedChange={(v) => setSwitches((s) => ({ ...s, [k.key]: v }))}
                    last={false}
                  />
                );
              })}
              <SwitchRow
                label="通行密钥登录（Passkey）"
                description="支持 Touch ID / Windows Hello / 手机等系统级通行密钥；用户在 设置 → 安全 注册后，登录页出现「使用通行密钥登录」"
                checked={switches["auth.passkeys"] ?? false}
                onCheckedChange={(v) => setSwitches((s) => ({ ...s, "auth.passkeys": v }))}
                last={false}
              />
              <SwitchRow
                label="启用邮件发送"
                description="关闭后验证码/通知邮件将不再发出（需已配置 SMTP）"
                checked={switches["notify.emailEnabled"] ?? false}
                onCheckedChange={(v) => setSwitches((s) => ({ ...s, "notify.emailEnabled": v }))}
                last
              />
            </div>
            <SettingsFooter hint="开关与凭证分开保存：先在下方保存凭证，再回到这里启用。">
              <Button onClick={save} disabled={saveMutation.pending}>
                <Save className="size-4" />
                {saveMutation.pending ? "保存中…" : "保存开关"}
              </Button>
            </SettingsFooter>
          </SettingsSection>
          <OAuthProvidersSection seed={seed.entries["oauth.providers"]} />
          <SmtpSection seed={seed.entries["smtp"]} />
        </div>
      )}

      {tab === "ratelimit" && <RateLimitBucketsSection seedValue={seed.entries["ratelimit.buckets"]} />}
      {tab === "llm" && <LlmProvidersPanel value={seed.entries["llm.providers"]} />}
      {tab === "exts" && <ExtensionSwitches seedValue={seed.entries["ext.enabled"]} />}
    </div>
  );
}

/* ------------------------- rate-limit buckets 区块 ------------------------- */

/** 秒 → 人类可读窗口（整分钟以上用分钟，其余用秒） */
function formatWindow(sec: number): string {
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60} 分钟` : `${sec} 秒`;
}

/**
 * 单字段校验 — 返回错误文案（null = 合法）。空串视为「恢复默认」由调用方
 * 跳过；负数/小数/非数字/越界一律在前端拦截，不发请求。
 */
function bucketFieldError(raw: string, label: string, min: number, max: number): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return `${label} 须为整数`;
  const n = Number(t);
  if (n < min || n > max) return `${label} 须在 ${min}–${max} 之间`;
  return null;
}

/**
 * 「访问频率限制」区块 — 列出 RATE_BUCKETS 全部桶：内置默认 + `ratelimit.buckets`
 * 覆盖值（生效中/默认区分态）。读取复用页面顶层的 settings useQuery（seed 透传），
 * 保存只提交覆盖项，留空行从覆盖对象移除 = 恢复默认。
 */
function RateLimitBucketsSection({ seedValue }: { seedValue: unknown }) {
  // 覆盖值解析 — 坏数据降级为空覆盖（全部默认），与页面「模型防线」思路一致
  const overrides: BucketOverrides = (() => {
    const parsed = bucketOverridesSchema.safeParse(seedValue);
    return parsed.success ? parsed.data : {};
  })();

  // 行草稿 — keyed 子组件随表单重播种 remount，以服务端权威值重新初始化
  const [drafts, setDrafts] = useState<Record<string, BucketDraft>>(() => {
    const next: Record<string, BucketDraft> = {};
    for (const b of RATE_BUCKETS) {
      const ov = overrides[b.name];
      next[b.name] = ov
        ? { limit: String(ov.limit), windowSec: String(ov.windowSec) }
        : { ...EMPTY_DRAFT };
    }
    return next;
  });

  // 保存限流配置 — 仅提交 ratelimit.buckets 键；成功失效设置键（重取 + 重播种）
  const saveMutation = useApiMutation(
    (payload: { entries: Record<string, unknown> }) => postJson("/api/admin/settings", payload),
    {
      refresh: false,
      invalidate: [queryKeys.adminSettings()],
      successToast: "限流配置已保存",
    },
  );

  function save() {
    // 以当前覆盖对象为底拷贝：保留本页未列出的键（如 Action 层经设置 API 写入的
    // `action.*` 扩展桶覆写）——否则整键替换会静默清空它们
    const payload: BucketOverrides = { ...overrides };
    for (const b of RATE_BUCKETS) {
      const d = drafts[b.name] ?? EMPTY_DRAFT;
      const hasLimit = d.limit.trim() !== "";
      const hasWindow = d.windowSec.trim() !== "";
      if (!hasLimit && !hasWindow) {
        delete payload[b.name]; // 留空 = 恢复默认（从覆盖对象移除该桶）
        continue;
      }
      const err =
        bucketFieldError(d.limit, `「${b.name}」limit`, 1, BUCKET_LIMIT_MAX) ??
        bucketFieldError(d.windowSec, `「${b.name}」windowSec`, 1, BUCKET_WINDOW_MAX);
      if (err) {
        toast.error(err); // 前端拦截，不发请求
        return;
      }
      // 单字段留空时该字段沿用内置默认（覆盖对象两项都必填）
      payload[b.name] = {
        limit: hasLimit ? Number(d.limit) : b.limit,
        windowSec: hasWindow ? Number(d.windowSec) : b.windowSec,
      };
    }
    void saveMutation.mutate({ entries: { "ratelimit.buckets": payload } });
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader description="调整各访问频率限制桶的阈值，留空表示沿用默认值。" />

      <Notice tone="info">
        限流键格式为「桶名:身份」。修改保存后经 10s 进程缓存生效（多 worker
        部署时各进程在 10s 内各自收敛）。
      </Notice>

      <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-left text-sm text-[color:var(--text-body)]">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">桶</th>
              <th className="px-3 py-2 font-medium">用途</th>
              <th className="px-3 py-2 font-medium">默认值</th>
              <th className="px-3 py-2 font-medium">当前生效</th>
              <th className="px-3 py-2 font-medium">limit</th>
              <th className="px-3 py-2 font-medium">windowSec（秒）</th>
            </tr>
          </thead>
          <tbody>
            {RATE_BUCKETS.map((b) => {
              const ov = overrides[b.name];
              const d = drafts[b.name] ?? EMPTY_DRAFT;
              const setDraft = (patch: Partial<BucketDraft>) =>
                setDrafts((prev) => ({
                  ...prev,
                  [b.name]: { ...(prev[b.name] ?? EMPTY_DRAFT), ...patch },
                }));
              return (
                <tr key={b.name} className="border-b border-border transition-colors last:border-0 hover:bg-[var(--hover)]">
                  <td className="px-3 py-2.5 font-mono text-xs">{b.name}</td>
                  <td className="max-w-56 px-3 py-2.5">
                    <p className="text-sm">{b.zh}</p>
                    <p className="text-xs text-muted-foreground">{b.en}</p>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {b.limit} 次 / {formatWindow(b.windowSec)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {(ov ?? b).limit} 次 / {formatWindow((ov ?? b).windowSec)}
                      </span>
                      <OverrideBadge overridden={Boolean(ov)} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={BUCKET_LIMIT_MAX}
                      step={1}
                      value={d.limit}
                      onChange={(e) => setDraft({ limit: e.target.value })}
                      placeholder={String(b.limit)}
                      aria-label={`${b.name} limit`}
                      className="w-28"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={BUCKET_WINDOW_MAX}
                      step={1}
                      value={d.windowSec}
                      onChange={(e) => setDraft({ windowSec: e.target.value })}
                      placeholder={String(b.windowSec)}
                      aria-label={`${b.name} windowSec`}
                      className="w-28"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SettingsFooter hint="留空的行保存后恢复默认值；两项只填其一时，另一项沿用默认值。">
        <Button onClick={save} disabled={saveMutation.pending}>
          <Save className="size-4" />
          {saveMutation.pending ? "保存中…" : "保存限流配置"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}

/* --------------------------- extension switches --------------------------- */

function ExtensionSwitches({ seedValue }: { seedValue: unknown }) {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<Record<string, boolean>>(
    (seedValue as Record<string, boolean> | undefined) ?? {},
  );
  const saveMutation = useApiMutation(
    (next: Record<string, boolean>) => postJson("/api/admin/settings", { entries: { "ext.enabled": next } }),
    {
      successToast: "扩展开关已保存（重启 dev server 后服务端生效）",
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings() }),
    },
  );

  const known = EXTENSION_MANIFESTS.map((m) => ({ id: m.id, title: m.title.zh }));
  return (
    <SettingsSection>
      <SettingsSectionHeader description="关闭的扩展将停止加载服务端能力（worker/事件/渠道），其独立页面按不存在处理。未列出的扩展默认启用。" />
      <div className="space-y-2">
        {known.map((k, i) => (
          <SwitchRow
            key={k.id}
            label={k.title}
            description={k.id}
            checked={map[k.id] !== false}
            onCheckedChange={(v) => {
              const next = { ...map, [k.id]: v };
              setMap(next);
              saveMutation.mutate(next);
            }}
            last={i === known.length - 1}
          />
        ))}
      </div>
      <SettingsFooter hint="开关即时保存；服务端 boot 门控在 dev 重启 / 生产重部署后完全生效。" />
    </SettingsSection>
  );
}
