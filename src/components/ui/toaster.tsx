"use client";

import { CircleAlert, CircleCheck, CircleX, Info, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

/**
 * 全局 toast（sonner 封装）— 与站内卡片/面板同一套设计语言：
 * 卡身保持中性（--card + 1px --border 边框），状态只通过图标着色表达
 * （成功/错误/警告/信息/加载），亮暗色全部走主题 token，无需单独适配。
 * 位置：top-center；偏移量避开 sticky 顶栏（桌面 48px / 移动端双层 96px）。
 */
function AppToaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      position="top-center"
      offset="56px"
      mobileOffset="104px"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      /* 用主题 token 覆写 sonner 的默认配色变量（内联样式优先级最高，
         亮暗色随 token 自动切换） */
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "!shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)]",
          description: "!text-muted-foreground",
          actionButton:
            "!h-7 !rounded-md !bg-primary !px-2.5 !text-xs !font-medium !text-primary-foreground",
          cancelButton:
            "!h-7 !rounded-md !border !border-border !bg-transparent !px-2.5 !text-xs !font-medium !text-muted-foreground",
        },
      }}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        error: <CircleX className="size-4 text-destructive" />,
        warning: <CircleAlert className="size-4 text-warning" />,
        info: <Info className="size-4 text-link" />,
        loading: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
      }}
      {...props}
    />
  );
}

export { AppToaster as Toaster };
