import { Award, BookOpen, Code2, Crown, Flag, Heart, Medal, Palette, PenLine, Rocket, Shield, Sparkles, Star, Users, Wrench, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BADGE_ICON_LABELS, BADGE_ICON_KEYS, badgeStyleClassName, type BadgeIconKey } from "./styles";

const ICONS: Record<BadgeIconKey, LucideIcon> = {
  medal: Medal, crown: Crown, shield: Shield, sparkles: Sparkles, heart: Heart,
  pen: PenLine, code: Code2, palette: Palette, rocket: Rocket, award: Award,
  star: Star, users: Users, wrench: Wrench, book: BookOpen, flag: Flag, zap: Zap,
};

export interface BadgeDisplayData {
  text: string;
  icon: string;
  style: string;
}

/** 徽章胶囊 — 全站统一渲染（卡片作者行/详情作者栏/主页/评论区）。 */
export function BadgeChip({
  badge,
  size = "sm",
  className,
}: {
  badge: BadgeDisplayData;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = (ICONS as Record<string, LucideIcon>)[badge.icon] ?? Medal;
  return (
    <span
      title={BADGE_ICON_LABELS[badge.icon as BadgeIconKey] ? `${badge.text}` : badge.text}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        badgeStyleClassName(badge.style),
        size === "md" ? "px-2.5 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]",
        className,
      )}
    >
      <Icon className={size === "md" ? "size-3.5" : "size-3"} aria-hidden />
      {badge.text}
    </span>
  );
}

/** 一行内多枚徽章的排布容器。 */
export function BadgeChipRow({
  badges,
  size = "sm",
  className,
}: {
  badges: BadgeDisplayData[];
  size?: "sm" | "md";
  className?: string;
}) {
  if (!badges?.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {badges.map((b, i) => (
        <BadgeChip key={`${b.text}-${i}`} badge={b} size={size} />
      ))}
    </span>
  );
}
