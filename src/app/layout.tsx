import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "./globals.css";
import { siteMetadata } from "@/lib/seo";
import { getLocale } from "@/lib/i18n/index.server";
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
        <I18nProvider locale={locale}>
          <DataProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
              {/* 在 ThemeProvider 内：toast 的亮暗色跟随站点主题 */}
              <Toaster />
            </ThemeProvider>
          </DataProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
