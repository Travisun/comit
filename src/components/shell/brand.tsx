"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Feather } from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/core/routes";

/**
 * Brand mark — the official comit.sh.svg wordmark asset.
 * Dark fill by default; inverted in dark mode for the gray canvas.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/comit.sh.svg"
      alt="comit.sh"
      className={cn("h-[20px] w-auto select-none dark:invert", className)}
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
      {/* 收起态（<lg）用 favicon 方标；展开态用完整字标 */}
      <img
        src="/icons/favicon@32w.png"
        alt={siteName}
        className="size-8 select-none rounded-md dark:invert lg:hidden"
      />
      <BrandMark className="hidden h-[22px] lg:block" />
    </Link>
  );
}

/** 创作 trigger — on the home page it pings the pinned composer to expand
 * and focus; anywhere else it routes home with ?compose=1. */
export function ComposerTrigger({ login }: { login?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (login) {
    return (
      <Link href={login} className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-none transition-opacity hover:opacity-90 md:size-9 md:px-0 lg:h-8 lg:w-full lg:px-3">
        <Feather className="size-3.5" />
        <span className="hidden text-[13px] lg:inline">创作</span>
      </Link>
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
