import { cn } from "@/lib/utils";

/**
 * 品牌 Logo 组件族 — SVG 优先（PNG 仅用于 favicon 兼容链与 PWA manifest）。
 *
 *  - `LogoMark`  方形图标（64 viewBox，/icons/logo-mark.svg）
 *  - `LogoFull`  横排完整字标（295×60 viewBox，/icons/logo-full.svg）
 *  - `BrandMark` 兼容旧签名（className 透传，替代原 comit.sh.svg 引用）
 *
 * 原始资产在 /logos（设计源文件）；web 资产发布到 /public/icons。
 * SVG 为黑色填充，深色模式经 dark:invert 反白。
 */

export function LogoMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo-mark.svg"
      alt="comit.sh"
      width={size}
      height={size}
      className={cn("select-none dark:invert", className)}
    />
  );
}

export function LogoFull({
  height = 22,
  className,
}: {
  height?: number;
  className?: string;
}) {
  // 原始比例 295:60 ≈ 4.92:1
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo-full.svg"
      alt="comit.sh"
      height={height}
      style={{ height, width: "auto" }}
      className={cn("select-none dark:invert", className)}
    />
  );
}

/** 兼容旧签名 — 旧用法传 className 控制尺寸（如 size-7 / hidden h-[22px]）。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo-mark.svg"
      alt="comit.sh"
      className={cn("h-5 w-auto select-none dark:invert", className)}
    />
  );
}
