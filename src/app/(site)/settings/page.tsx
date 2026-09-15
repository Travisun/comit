import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  ChevronRight,
  Database,
  EyeOff,
  Globe,
  KeyRound,
  Link2,
  Mail,
  ShieldCheck,
  Terminal,
  UserRound,
} from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n";
import { TimelineHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "设置", robots: { index: false, follow: false } };

const GROUPS = [
  {
    label: { zh: "账户", en: "Account" },
    items: [
      { href: "/settings/profile", label: { zh: "资料", en: "Profile" }, desc: { zh: "昵称、头像、简介与界面语言", en: "Name, avatar, bio and language" }, icon: UserRound },
      { href: "/settings/email", label: { zh: "邮箱", en: "Email" }, desc: { zh: "绑定或更换登录邮箱", en: "Bind or change your email" }, icon: Mail },
      { href: "/settings/security", label: { zh: "安全", en: "Security" }, desc: { zh: "密码、两步验证与登录会话", en: "Password, 2FA and sessions" }, icon: ShieldCheck },
      { href: "/settings/connections", label: { zh: "账号绑定", en: "Connections" }, desc: { zh: "绑定或解绑 GitHub / Google 登录", en: "Link or unlink GitHub / Google" }, icon: Link2 },
      { href: "/settings/privacy", label: { zh: "隐私", en: "Privacy" }, desc: { zh: "主页内容的可见范围", en: "Profile visibility controls" }, icon: EyeOff },
      { href: "/settings/notifications", label: { zh: "通知", en: "Notifications" }, desc: { zh: "通知渠道与接收偏好", en: "Channels and preferences" }, icon: Bell },
    ],
  },
  {
    label: { zh: "身份", en: "Identity" },
    items: [
      { href: "/settings/username", label: { zh: "用户名", en: "Username" }, desc: { zh: "主页地址，每 30 天可修改一次", en: "Your profile URL, changeable every 30 days" }, icon: Globe },
      { href: "/settings/invites", label: { zh: "邀请码", en: "Invites" }, desc: { zh: "生成邀请码并查看使用情况", en: "Generate and track invite codes" }, icon: KeyRound },
      { href: "/settings/verification", label: { zh: "认证", en: "Verification" }, desc: { zh: "申请身份认证徽章", en: "Apply for a verification badge" }, icon: BadgeCheck },
    ],
  },
  {
    label: { zh: "开发者", en: "Developer" },
    items: [
      { href: "/settings/mcp", label: { zh: "MCP", en: "MCP" }, desc: { zh: "AI 客户端接入端点", en: "Endpoint for AI clients" }, icon: Terminal },
      { href: "/settings/api", label: { zh: "API", en: "API" }, desc: { zh: "API 令牌与 Webhook", en: "API tokens and webhooks" }, icon: KeyRound },
    ],
  },
  {
    label: { zh: "数据", en: "Data" },
    items: [
      { href: "/settings/export", label: { zh: "数据导出", en: "Export data" }, desc: { zh: "打包下载你的全部内容", en: "Download all of your content" }, icon: Database },
      { href: "/settings/delete", label: { zh: "账户删除", en: "Delete account" }, desc: { zh: "注销账户，此操作不可恢复", en: "Permanently delete your account" }, icon: AlertTriangle },
    ],
  },
];

export default async function SettingsHomePage() {
  const auth = await requireUser();
  const { t, locale } = await getT();
  void auth;
  const zh = locale === "zh";

  return (
    <div className="w-full pt-[10px]">
      <TimelineHeader title={zh ? "设置" : "Settings"} />
      <div className="mx-auto w-full max-w-[600px] pb-10">
        {GROUPS.map((group) => (
          <section key={group.label.en} className="border-b border-border py-2 first:pt-0">
            <h2 className="px-4 py-2 text-xs font-normal uppercase tracking-wider text-muted-foreground">
              {zh ? group.label.zh : group.label.en}
            </h2>
            <ul>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-lg px-4 py-2 transition-colors hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--muted)] text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {zh ? item.label.zh : item.label.en}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {zh ? item.desc.zh : item.desc.en}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
