import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "./globals.css";
import { siteMetadata } from "@/lib/seo";
import { getLocale } from "@/lib/i18n/index.server";
import { getSetting } from "@/lib/settings";
import { LoginDialog } from "@/components/social/login-dialog";
import { config } from "@/core/config";
import { I18nProvider } from "@/lib/i18n/client";
import { DataProvider } from "@/lib/query/provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/primitives";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = siteMetadata();

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
  const [siteName, inviteRequired] = await Promise.all([
    getSetting("site.name"),
    getSetting("site.inviteRequired"),
  ]);
  const oauthProviders = (
    [
      { key: "github", label: "GitHub", on: Boolean(config.oauth.github.clientId) },
      { key: "google", label: "Google", on: Boolean(config.oauth.google.clientId) },
      { key: "x", label: "X (Twitter)", on: Boolean(config.oauth.x.clientId) },
      { key: "linuxdo", label: "Linux.do", on: Boolean(config.oauth.linuxdo.clientId) },
      {
        key: "discourse",
        label: "Discourse",
        on: Boolean(config.oauth.discourse.url && config.oauth.discourse.secret),
      },
      {
        key: "cfaccess",
        label: "Cloudflare Access",
        on: Boolean(config.oauth.cfAccess.team),
      },
    ] as const
  )
    .filter((p) => p.on)
    .map((p) => ({ key: p.key, label: p.label }));

  return (
    <LoginDialog providers={oauthProviders} siteName={siteName} inviteRequired={inviteRequired} />
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
              <LoginDialogHost />
            </ThemeProvider>
          </DataProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
