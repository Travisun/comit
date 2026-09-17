"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { routes } from "@/core/routes";
import { cn } from "@/lib/utils";
import { postJsonSafe } from "@/lib/client/api";
import { useLoginDialogStore } from "@/lib/store/login-dialog";

/**
 * 全局登录引导 Dialog — 游客交互入口统一唤起。
 * 视觉：高透明遮罩 + 居中卡片；信息层级：OSS 一键登录为主，邮箱登录/注册
 * 折叠为次级选项，底部保留完整注册页入口（邀请码等完整流程）。
 */

export interface LoginDialogProvider {
  key: string;
  label: string;
}

/** OSS 提供商品牌图标（内联 SVG，避免额外依赖）。 */
function ProviderIcon({ provider }: { provider: string }) {
  const cls = "size-4 shrink-0";
  switch (provider) {
    case "github":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.91c.58.11.79-.25.79-.55v-1.94c-3.2.7-3.87-1.54-3.87-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.09 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.74.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12v3.14c0 .3.2.67.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
        </svg>
      );
    case "google":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24Z" />
          <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1Z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.87 8.87 4.75 12 4.75Z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.3 17.4Z" />
        </svg>
      );
    case "linuxdo":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <circle cx="12" cy="12" r="10" fillOpacity="0.15" />
          <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">
            L
          </text>
        </svg>
      );
    case "discourse":
    case "cfaccess":
    default:
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8M12 8v8" />
        </svg>
      );
  }
}

export function LoginDialog({
  providers,
  siteName = "社区",
  inviteRequired = false,
}: {
  /** 已启用的 OSS 提供商（服务端配置过滤后传入） */
  providers: LoginDialogProvider[];
  siteName?: string;
  inviteRequired?: boolean;
}) {
  const open = useLoginDialogStore((s) => s.open);
  const closeDialog = useLoginDialogStore((s) => s.closeDialog);
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [agree, setAgree] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const emailMutation = useMutation({
    mutationFn: async () => {
      if (mode === "login") {
        const r = await postJsonSafe<{ status?: string }>("/api/auth/login", {
          email,
          password,
        });
        return r;
      }
      return postJsonSafe<{ ok?: boolean }>(
        "/api/auth/register",
        inviteRequired
          ? { username, email, password, agree: true, inviteCode }
          : { username, email, password, agree: true },
      );
    },
    onSuccess: (r) => {
      if (!r.ok) {
        setErr(r.error ?? "操作失败");
        return;
      }
      // 强制 2FA 的站点：登录进入待验证会话 → 跳 2FA 流程页
      const status = (r.data as { status?: string } | undefined)?.status;
      closeDialog();
      if (mode === "login" && status) {
        router.push(status === "2fa_setup" ? routes.twofaSetup : routes.twofaChallenge);
        return;
      }
      router.refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "操作失败"),
  });

  const submitting = emailMutation.isPending;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] flex items-center justify-center px-4 transition-opacity",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="登录"
      hidden={!open}
    >
      {/* 高透明遮罩：内容依旧可见，仅轻微压暗聚焦弹窗 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={closeDialog}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
      />
      <div
        className={cn(
          "relative w-full max-w-sm rounded-2xl border border-border/80 bg-card/95 p-6 shadow-[0_12px_48px_rgba(42,47,69,0.25)] backdrop-blur-md transition-transform",
          open ? "scale-100" : "scale-95",
        )}
      >
        <button
          type="button"
          aria-label="关闭"
          onClick={closeDialog}
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <h2 className="text-lg font-semibold">加入 {siteName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          登录后即可发布、评论、点赞与关注你感兴趣的作者。
        </p>

        {/* OSS 一键登录（主选项） */}
        <div className="mt-5 grid gap-2">
          {providers.map((p) => (
            <a
              key={p.key}
              href={routes.oauthStart(p.key)}
              className="flex h-10 items-center justify-center gap-2.5 rounded-full border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-[var(--hover)]"
            >
              <ProviderIcon provider={p.key} />
              使用 {p.label} 继续
            </a>
          ))}
          {providers.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">站点未开启第三方登录</p>
          )}
        </div>

        {/* 邮箱 登录/注册（次级选项） */}
        <div className="mt-5">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setErr(null);
              }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {mode === "login" ? "使用邮箱登录" : "使用邮箱注册"}
            </button>
            <span className="h-px flex-1 bg-border" />
          </div>

          {mode === "register" && (
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名（主页地址 /username）"
              className="mt-3"
              autoComplete="username"
            />
          )}
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            className="mt-2"
            autoComplete="email"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            className="mt-2"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {inviteRequired && mode === "register" && (
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="邀请码"
              className="mt-2"
            />
          )}
          {mode === "register" && (
            <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                我已阅读并同意
                <Link href={routes.legal.terms} target="_blank" className="text-primary hover:underline">
                  服务协议
                </Link>
                与
                <Link href={routes.legal.privacy} target="_blank" className="text-primary hover:underline">
                  隐私政策
                </Link>
              </span>
            </label>
          )}
          {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
          <Button
            className="mt-3 w-full rounded-full"
            disabled={submitting || (mode === "register" && !agree)}
            onClick={() => emailMutation.mutate()}
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {mode === "login" ? "登录" : "注册并登录"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            需要邀请码或更多选项？使用
            <Link href={mode === "login" ? routes.login : routes.register} className="mx-1 text-primary hover:underline">
              完整页面
            </Link>
            继续
          </p>
        </div>
      </div>
    </div>
  );
}

/** 游客占位发布盒 — 样式对齐 composer mini 条，点击唤起登录引导。 */
export function GuestComposerPlaceholder({
  label = "登录后发布动态 · 一次登录，全站畅聊",
}: {
  label?: string;
}) {
  const openDialog = useLoginDialogStore((s) => s.openDialog);
  return (
    <button
      type="button"
      onClick={openDialog}
      className="flex w-full items-center gap-2 rounded-2xl border bg-card/95 px-3 py-2 text-left shadow-[0_4px_16px_rgba(42,47,69,0.12)] transition-colors hover:border-primary/40"
    >
      <span className="h-9 min-w-0 flex-1 truncate rounded-full bg-[var(--muted)] px-4 text-sm leading-9 text-muted-foreground">
        {label}
      </span>
    </button>
  );
}
