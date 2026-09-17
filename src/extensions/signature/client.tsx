"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { appToast } from "@/lib/client/toast";
import { useZodForm } from "@/lib/validation";
import { queryKeys } from "@/lib/query/keys";
import { } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { apiGet, putJson } from "@/lib/client/api";
import {
  registerInterruptRenderer,
} from "@/lib/plugins/registry";

/**
 * 签名档扩展 · 客户端：导航项 / 用户菜单项 / rail widget / 登录可见打断
 * 渲染器 / 独立设置页（bare 布局，/e/signature）。
 */

type SignatureSettings = Record<string, unknown>;

const SETTINGS_URL = "/api/ext/signature/settings";

function useSignatureSettings() {
  return useQuery({
    queryKey: queryKeys.extSignatureSettings(),
    queryFn: async () => (await apiGet<{ settings: SignatureSettings }>(SETTINGS_URL)).settings,
    enabled: typeof document !== "undefined",
    staleTime: 30_000,
  });
}

/* -------------------- 独立设置页（bare 布局） -------------------- */

export function SignaturePage() {
  const q = useSignatureSettings();

  if (q.error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-semibold">登录后可配置签名档</p>
        <Button asChild>
          <Link href="/auth/login">去登录</Link>
        </Button>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  // 数据到达后再挂载表单（key 保证换用户/刷新时重置）
  return <SignatureForm key={JSON.stringify(q.data)} initial={q.data} />;
}

const signatureSchema = z.object({
  content: z.string().max(200, "签名最多 200 字"),
  enabled: z.boolean(),
  placement: z.enum(["append", "prepend"]),
  loginRequired: z.boolean(),
});

function SignatureForm({ initial }: { initial: SignatureSettings }) {
  const form = useZodForm(signatureSchema, {
    content: String(initial.content ?? ""),
    enabled: Boolean(initial.enabled),
    placement: initial.placement === "prepend" ? "prepend" : "append",
    loginRequired: Boolean(initial.loginRequired),
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await form.submit(async (data) => {
        await putJson(SETTINGS_URL, data);
        appToast.success("签名档已保存");
      });
    } catch (err) {
      appToast.fromError(err, "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-lg font-bold">签名档</h1>
      <p className="text-xs text-muted-foreground">
        签名会按你的设置插入到自己文章的正文中。这是「扩展设置」能力的完整示范：表单由扩展清单声明驱动。
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.values.enabled} onChange={(e) => form.setField("enabled", e.target.checked)} />
        启用签名档
      </label>
      <div className="grid gap-1.5">
        <Label htmlFor="sig-content">签名内容</Label>
        {form.errors.content && (
          <p className="text-xs text-destructive">{form.errors.content}</p>
        )}
        <Textarea
          id="sig-content"
          value={form.values.content}
          onChange={(e) => form.setField("content", e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="—— 由 comit.sh 强力驱动"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sig-placement">插入位置</Label>
        <select
          id="sig-placement"
          value={form.values.placement}
          onChange={(e) => form.setField("placement", e.target.value === "prepend" ? "prepend" : "append")}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
        >
          <option value="append">正文之后</option>
          <option value="prepend">正文之前</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.values.loginRequired}
          onChange={(e) => form.setField("loginRequired", e.target.checked)}
        />
        仅登录可见正文（渲染打断演示）
      </label>
      <Button onClick={() => void save()} disabled={saving}>
        {saving ? "保存中…" : "保存"}
      </Button>
      <Link href="/" className="text-xs text-muted-foreground hover:underline">
        ← 返回首页
      </Link>
    </div>
  );
}

/* -------------------- rail widget -------------------- */


/* -------------------- 登录可见打断渲染器 -------------------- */

const LoginRequiredCard: import("react").ComponentType<{
  info: { code: string; message?: string; data?: Record<string, unknown> };
}> = function LoginRequiredCard({ info }) {
  return (
    <div className="my-6 rounded-xl border border-border bg-muted/40 p-6 text-center">
      <p className="text-sm font-medium">{info.message ?? "本文仅登录用户可见"}</p>
      <Button asChild className="mt-3">
        <Link href="/auth/login">登录后查看</Link>
      </Button>
    </div>
  );
};

/* -------------------- 注册（模块导入即生效） -------------------- */

registerInterruptRenderer("ext.signature", LoginRequiredCard);
