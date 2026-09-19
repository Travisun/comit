/**
 * 徽章样式与图标白名单（客户端安全：纯数据 + 组件映射）。
 * 后台定制徽章时从中选择；新增样式/图标只改本文件。
 */

export interface BadgeStylePreset {
  label: string;
  /** 胶囊样式（底/字/描边） */
  className: string;
}

export const BADGE_STYLES: Record<string, BadgeStylePreset> = {
  official: { label: "官方蓝", className: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  ops: { label: "运营青", className: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  admin: { label: "管理红", className: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
  genesis: { label: "创世紫", className: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  cute: { label: "小可爱粉", className: "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  writer: { label: "作家琥珀", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  dev: { label: "开发者绿", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  designer: { label: "设计师靛", className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400" },
  slate: { label: "中性灰", className: "border-border bg-[var(--muted)] text-muted-foreground" },
};

export function badgeStyleClassName(style: string | null | undefined): string {
  return (style && BADGE_STYLES[style]?.className) || BADGE_STYLES.slate.className;
}

/** 图标白名单（与 BadgeIcon 组件的映射一致） */
export const BADGE_ICON_KEYS = [
  "medal", "crown", "shield", "sparkles", "heart", "pen", "code", "palette",
  "rocket", "award", "star", "users", "wrench", "book", "flag", "zap",
] as const;

export type BadgeIconKey = (typeof BADGE_ICON_KEYS)[number];

export const BADGE_ICON_LABELS: Record<BadgeIconKey, string> = {
  medal: "勋章", crown: "王冠", shield: "盾牌", sparkles: "闪耀", heart: "爱心",
  pen: "笔", code: "代码", palette: "调色板", rocket: "火箭", award: "奖章",
  star: "星星", users: "伙伴", wrench: "扳手", book: "书卷", flag: "旗帜", zap: "闪电",
};
