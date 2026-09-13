"use client";

import { ExternalLink, Lightbulb, Megaphone, Repeat2, Sparkles, UserCheck, Bot, type LucideIcon } from "lucide-react";
import { getLabelDef, labelBadgeStyle, type ContentLabelId } from "@/lib/content-labels";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/primitives";

/**
 * Reader-facing badge for a post's content annotation (Douyin-style).
 *
 * - Badge tinted with the label color + hover tooltip with the label's desc.
 * - `repost` renders as a link to the source (rel="nofollow noopener"),
 *   suffixed with the source name when provided.
 * - `size="sm"` fits cards and feeds; `size="md"` suits the article header.
 * - Keep it dumb: callers decide whether to hide "original" in compact
 *   contexts (cards) by conditionally rendering the component.
 */

export interface AnnotationBadgeProps {
  label: string;
  sourceUrl?: string | null;
  sourceName?: string | null;
  size?: "sm" | "md";
  className?: string;
}

/** Icon per label — also reused by the editor pickers. */
export const LABEL_ICONS: Record<ContentLabelId, LucideIcon> = {
  original: UserCheck,
  ai_assisted: Sparkles,
  ai_generated: Bot,
  repost: Repeat2,
  opinion: Lightbulb,
  sponsored: Megaphone,
};

export function AnnotationBadge({
  label,
  sourceUrl,
  sourceName,
  size = "sm",
  className,
}: AnnotationBadgeProps) {
  const { locale } = useI18n();
  const def = getLabelDef(label);
  const style = labelBadgeStyle(def);
  const Icon = LABEL_ICONS[def.id];
  const name = def.name[locale];
  const text =
    def.id === "repost" && sourceName ? `${name} · ${sourceName}` : name;
  const isLink = def.id === "repost" && Boolean(sourceUrl);

  const inner = (
    <>
      <Icon aria-hidden />
      <span className="truncate">{text}</span>
      {isLink && <ExternalLink className="shrink-0 opacity-70" aria-hidden />}
    </>
  );

  const shared = cn(
    "label-chip inline-flex max-w-full items-center gap-1 rounded-full border font-medium transition-colors",
    size === "md" ? "px-3 py-1 text-xs [&_svg]:size-3.5" : "px-2 py-0.5 text-[11px] [&_svg]:size-3",
    isLink && "hover:brightness-95",
    className,
  );

  const badge = isLink ? (
    <a
      href={sourceUrl as string}
      target="_blank"
      rel="nofollow noopener noreferrer"
      title={sourceName ? `${name}：${sourceName}` : name}
      onClick={(e) => e.stopPropagation()}
      className={cn(shared, "cursor-pointer")}
      style={style}
    >
      {inner}
    </a>
  ) : (
    <span className={shared} style={style}>
      {inner}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-64">
        {def.desc[locale]}
        {isLink && (
          <span className="mt-0.5 block opacity-70">
            {locale === "zh" ? "点击查看原文" : "Click to open the source"}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
