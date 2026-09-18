"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { ProviderIcon } from "@/components/brand/provider-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { routes } from "@/core/routes";
import { cn } from "@/lib/utils";
import { postJsonSafe } from "@/lib/client/api";
import { useLoginDialogStore } from "@/lib/store/login-dialog";

/**
 * 全局登录引导 Dialog — 游客交互入口统一唤起。
 * 视觉：高透明遮罩 + 居中卡片；信息层级：OSS 一键登录为主，邮箱登录/注册
 * 折叠为次级选项（后台关闭密码登录时整块隐藏），底部保留完整注册页入口。
 * 未登录访客浏览内容页时自动弹出一次（/auth/* 页面自身除外）。
 */

export interface LoginDialogProvider {
  key: string;
  label: string;
}

export function LoginDialog({
  providers,
  siteName = "社区",
  inviteRequired = false,
  authenticated = true,
  passwordAuth = true,
}: {
  /** 已启用的 OSS 提供商（服务端配置过滤后传入） */
  providers: LoginDialogProvider[];
  siteName?: string;
  inviteRequired?: boolean;
  /** 访客是否已登录（false 时首次进入内容页自动弹出） */
  authenticated?: boolean;
  /** 后台「账号密码登录与注册」开关；关闭后 dialog 仅展示 OSS 登录 */
  passwordAuth?: boolean;
}) {
  const open = useLoginDialogStore((s) => s.open);
  const openDialog = useLoginDialogStore((s) => s.openDialog);
  const closeDialog = useLoginDialogStore((s) => s.closeDialog);
  const router = useRouter();
  const pathname = usePathname();

  // 游客浏览默认弹出：每次完整页面加载至多一次；登录/注册等 /auth 页面排除；
  // 站点没有任何可用登录方式（无 OSS 且密码登录关闭）时不弹
  useEffect(() => {
    if (authenticated) return;
    if (pathname.startsWith("/auth")) return;
    if (providers.length === 0 && !passwordAuth) return;
    openDialog();
    // 仅挂载时判定一次 —— 客户端路由切换不重复打扰
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          identifier: email,
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
      {/* 高透明遮罩：内容依旧可见，仅轻微压暗聚焦弹窗。点击不关闭 —— 避免
          误触丢失登录意愿，关闭只走卡片右上角 ✕ 与底部「关闭」文字 */}
      <div aria-hidden className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
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

        {/* 邮箱 登录/注册（次级选项）— 后台关闭密码登录时整块隐藏，仅保留 OSS */}
        {passwordAuth && (
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
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={mode === "login" ? "邮箱或用户名" : "邮箱"}
            className="mt-2"
            autoComplete="username"
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
        )}
        <button
          type="button"
          onClick={closeDialog}
          className="mt-4 w-full text-center text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          关闭
        </button>
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
