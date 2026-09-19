import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "./globals.css";
import { siteMetadata } from "@/lib/seo";
import { getLocale } from "@/lib/i18n/index.server";
import { getSetting, type SettingsKey } from "@/lib/settings";
import { LoginDialog } from "@/components/social/login-dialog";
import { oauthEnabled } from "@/lib/auth/oauth";
import { getCurrentUser } from "@/lib/auth/session";
import { I18nProvider } from "@/lib/i18n/client";
import { DataProvider } from "@/lib/query/provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/primitives";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { TopProgressBar } from "@/components/shell/top-progress-bar";

/**
 * 全站 metadata 动态生成：站点名/描述/关键词/OG 图/robots 全部来自 admin
 * 站点设置（getSiteBrand，双层缓存）——后台改名即全站 <head> 生效。
 */
export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata();
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

/** 登录引导 Dialog 的宿主 — 服务端读取启用中的 OSS 提供商与站点参数注入。 */
async function LoginDialogHost() {
  const [siteName, inviteRequired, passwordAuth, viewer] = await Promise.all([
    getSetting("site.name"),
    getSetting("site.inviteRequired"),
    getSetting("auth.passwordAuth"),
    getCurrentUser(),
  ]);
  // 与登录页 OAuthButtons 同一套启用判定：env 凭证 + 后台 sso.* 开关缺一不可
  const oauthProviders = (
    await Promise.all(
      (
        [
          { key: "linuxdo", label: "Linux.do" },
          { key: "github", label: "GitHub" },
          { key: "google", label: "Google" },
          { key: "x", label: "X (Twitter)" },
          { key: "discourse", label: "Discourse" },
          { key: "cfaccess", label: "Cloudflare Access" },
        ] as const
      ).map(async (p) => ({
        ...p,
        on: (await oauthEnabled(p.key)) && (await getSetting(`sso.${p.key}` as SettingsKey)),
      })),
    )
  )
    .filter((p) => p.on)
    .map((p) => ({ key: p.key, label: p.label }));

  return (
    <LoginDialog
      providers={oauthProviders}
      siteName={siteName}
      inviteRequired={inviteRequired}
      authenticated={Boolean(viewer)}
      passwordAuth={passwordAuth}
    />
  );
}

/** Minimal root shell — chrome (site header / dashboard shell) lives in route groups. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale === "zh" ? "zh-CN" : "en"}
      // globals.css 里 html { scroll-behavior: smooth } — 该标记让 Next 在
      // 路由切换期间临时禁用平滑滚动（瞬间回顶），结束后恢复，消除导航时的滚动动画
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="min-h-dvh flex flex-col">
        <TopProgressBar />
        {process.env.NODE_ENV !== "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html: [
                "if('serviceWorker' in navigator){",
                "navigator.serviceWorker.getRegistrations().then(function(rs){",
                "if(rs.length){rs.forEach(function(r){r.unregister();});",
                "console.info('[dev-hygiene] unregistered '+rs.length+' service worker(s)');}});",
                "if(window.caches&&caches.keys){caches.keys().then(function(ks){",
                "ks.forEach(function(k){caches.delete(k);});});}",
                "}",
              ].join(""),
            }}
          />
        )}
        <I18nProvider locale={locale}>
          <DataProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
              {/* 在 ThemeProvider 内：toast 的亮暗色跟随站点主题 */}
              <Toaster />
              <ConfirmDialogProvider />
              <LoginDialogHost />
            </ThemeProvider>
          </DataProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
