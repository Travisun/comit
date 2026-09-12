import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { siteMetadata } from "@/lib/seo";
import { getLocale } from "@/lib/i18n/index.server";
import { I18nProvider } from "@/lib/i18n/client";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/primitives";

export const metadata: Metadata = siteMetadata();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1b1e" },
  ],
};

/** Minimal root shell — chrome (site header / dashboard shell) lives in route groups. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} suppressHydrationWarning>
      <body className="min-h-dvh flex flex-col">
        <I18nProvider locale={locale}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
