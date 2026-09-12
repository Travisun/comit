"use client";

import { BadgeCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { cn, formatDate } from "@/lib/utils";
import {
  VERIFICATION_BADGE_FALLBACK,
  VERIFICATION_BADGE_STYLES,
  VERIFICATION_TYPE_MAP,
  type VerificationBadge,
} from "@/lib/verification";

// Re-exported so consumers of the badge can render type metadata (names,
// descriptions, colors) without importing the server graph.
export { VERIFICATION_TYPES, VERIFICATION_TYPE_MAP, verificationTypeName } from "@/lib/verification";

/**
 * V badge (微博/B站 认证标): a filled BadgeCheck colored by verification
 * track, wrapped in a tooltip — `个人认证 · 前端工程师 · 于 2026年1月1日 认证`.
 * Renders nothing when the user is unverified.
 */
export function VerifiedBadge({
  verified,
  size = "sm",
  className,
}: {
  verified: VerificationBadge | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const { locale } = useI18n();
  if (!verified) return null;

  const info = VERIFICATION_TYPE_MAP[verified.type];
  const style = VERIFICATION_BADGE_STYLES[verified.type] ?? VERIFICATION_BADGE_FALLBACK;
  const typeName = info ? (locale === "en" ? info.name.en : info.name.zh) : verified.type;
  const date = formatDate(verified.approvedAt, locale);
  const tip =
    locale === "zh"
      ? `${typeName} · ${verified.label} · 于 ${date} 认证`
      : `${typeName} · ${verified.label} · Verified on ${date}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex shrink-0 items-center align-middle", className)}
          aria-label={tip}
          role="img"
        >
          <BadgeCheck
            className={cn(
              style.fill,
              size === "md" ? "size-6" : "size-4",
              "drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]",
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
