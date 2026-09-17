"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Feather } from "lucide-react";
import { LogoFull } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";

/** 兼容旧签名 — 移动端顶栏等处的小尺寸图标位。 */
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

export function BrandLink({ siteName }: { siteName: string }) {
  return (
    <Link
      href={routes.home}
      className="inline-flex items-center rounded-[10px] p-2"
      aria-label={siteName}
    >
      {/* 收起态（<lg）：方形图标；展开态（lg）：完整字标 — SVG 优先 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/logo-mark.svg"
        alt={siteName}
        className="size-8 select-none rounded-md dark:invert lg:hidden"
      />
      <LogoFull className="hidden lg:block" height={22} />
    </Link>
  );
}

/** 创作 trigger — on the home page it pings the pinned composer to expand
 * and focus; anywhere else it routes home with ?compose=1. */
export function ComposerTrigger({
  login,
  onGuestClick,
}: {
  login?: string;
  /** 游客点击 → 唤起登录引导 Dialog（优先于 login 跳转） */
  onGuestClick?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (login) {
    return (
      <button
        type="button"
        onClick={onGuestClick}
        className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:size-9 md:px-0 lg:h-8 lg:w-full lg:px-3"
      >
        <Feather className="size-3.5" />
        <span className="hidden text-[13px] lg:inline">创作</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => {
      if (pathname === "/") window.dispatchEvent(new CustomEvent("composer:focus"));
      else router.push("/?compose=1");
    }}
      className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:size-9 md:px-0 lg:h-8 lg:w-full lg:px-3">
      <Feather className="size-3.5" />
      <span className="hidden text-[13px] lg:inline">创作</span>
    </button>
  );
}
