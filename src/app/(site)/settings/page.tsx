import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  Database,
  Globe,
  ShieldCheck,
  Terminal,
  UserRound,
} from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n";
import { TimelineHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "设置", robots: { index: false, follow: false } };

const GROUPS: {
  label: { zh: string; en: string };
  items: { href: string; label: { zh: string; en: string }; desc: { zh: string; en: string }; icon: React.ElementType }[];
}[] = [
  {
    label: { zh: "账户", en: "Account" },
    items: [
      { href: "/settings/profile", label: { zh: "资料", en: "Profile" }, desc: { zh: "头像、昵称、简介与社交链接", en: "Avatar, name, bio and social links" }, icon: UserRound },
      { href: "/settings/security", label: { zh: "安全", en: "Security" }, desc: { zh: "密码、两步验证与登录会话", en: "Password, 2FA and sessions" }, icon: ShieldCheck },
      { href: "/settings/notifications", label: { zh: "通知", en: "Notifications" }, desc: { zh: "按事件选择接收渠道", en: "Choose channels per event" }, icon: Bell },
      { href: "/settings/verification", label: { zh: "认证", en: "Verification" }, desc: { zh: "申请身份认证徽章", en: "Apply for a verification badge" }, icon: BadgeCheck },
    ],
  },
  {
    label: { zh: "站点", en: "Site" },
    items: [
      { href: "/settings/site", label: { zh: "站点", en: "Site" }, desc: { zh: "子域名与邀请码", en: "Subdomain and invites" }, icon: Globe },
    ],
  },
  {
    label: { zh: "开发者", en: "Developer" },
    items: [
      { href: "/settings/developers", label: { zh: "开发设置", en: "Developer" }, desc: { zh: "Webhook 与 API · MCP 令牌", en: "Webhooks and API · MCP tokens" }, icon: Terminal },
      { href: "/settings/data", label: { zh: "数据与导出", en: "Data & export" }, desc: { zh: "导出你的全部内容", en: "Export all of your content" }, icon: Database },
    ],
  },
];

export default async function SettingsHomePage() {
  const auth = await requireUser();
  const { t, locale } = await getT();
  void auth;
  const zh = locale === "zh";

  return (
    <div className="w-full">
      <TimelineHeader title={zh ? "设置" : "Settings"} />
      <div className="mx-auto w-full max-w-[600px] pb-10">
        {GROUPS.map((group) => (
          <section key={group.label.en} className="border-b border-border py-2 first:pt-0">
            <h2 className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {zh ? group.label.zh : group.label.en}
            </h2>
            <ul>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-[var(--hover)]"
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
