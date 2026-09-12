import type { CSSProperties } from "react";

/**
 * Content annotation system (Douyin-style content labels).
 *
 * A post carries exactly one `label` (posts.label, varchar(24), default
 * "original") plus optional source attribution fields (posts.sourceUrl /
 * posts.sourceName, used by the "repost" label).
 *
 * This module is client-safe and server-safe (no side effects, no db access):
 * the API uses it for validation, the editors for the picker UI and the
 * reader-facing AnnotationBadge for display.
 */

export const CONTENT_LABEL_IDS = [
  "original",
  "ai_assisted",
  "ai_generated",
  "repost",
  "opinion",
  "sponsored",
] as const;

export type ContentLabelId = (typeof CONTENT_LABEL_IDS)[number];

export interface ContentLabelDef {
  id: ContentLabelId;
  /** display name per locale */
  name: { zh: string; en: string };
  /** explanation shown in editor tooltips and on the article page */
  desc: { zh: string; en: string };
  /** base color (hex) — the badge derives tinted bg / text / border from it */
  color: string;
  /** repost must provide a source URL (enforced by the API) */
  needsSource: boolean;
}

export const DEFAULT_LABEL: ContentLabelId = "original";

export const CONTENT_LABELS: ContentLabelDef[] = [
  {
    id: "original",
    name: { zh: "原创", en: "Original" },
    desc: {
      zh: "作者声明该内容为本人原创",
      en: "The author declares this content as their own original work",
    },
    color: "#16a34a", // green-600
    needsSource: false,
  },
  {
    id: "ai_assisted",
    name: { zh: "AI 辅助", en: "AI-assisted" },
    desc: {
      zh: "部分内容由 AI 工具辅助生成，作者已审核修改",
      en: "Parts of this content were drafted with AI tools and reviewed by the author",
    },
    color: "#2563eb", // blue-600
    needsSource: false,
  },
  {
    id: "ai_generated",
    name: { zh: "AI 生成", en: "AI-generated" },
    desc: {
      zh: "该内容主要由 AI 自动生成",
      en: "This content was mostly generated automatically by AI",
    },
    color: "#4f46e5", // indigo-600
    needsSource: false,
  },
  {
    id: "repost",
    name: { zh: "转载", en: "Repost" },
    desc: {
      zh: "内容转载自外部来源，版权归原作者所有",
      en: "Reposted from an external source; copyright belongs to the original author",
    },
    color: "#6b7280", // gray-500
    needsSource: true,
  },
  {
    id: "opinion",
    name: { zh: "个人观点", en: "Opinion" },
    desc: {
      zh: "仅代表作者个人观点，不代表平台立场",
      en: "Represents the author's personal view only, not the platform's stance",
    },
    color: "#ea580c", // orange-600
    needsSource: false,
  },
  {
    id: "sponsored",
    name: { zh: "赞助内容", en: "Sponsored" },
    desc: {
      zh: "商业推广或赞助内容",
      en: "Commercial promotion or sponsored content",
    },
    color: "#ca8a04", // yellow-600
    needsSource: false,
  },
];

/** Unknown ids (e.g. legacy rows) fall back to the default label. */
export function isValidLabel(id: unknown): id is ContentLabelId {
  return (
    typeof id === "string" && (CONTENT_LABEL_IDS as readonly string[]).includes(id)
  );
}

export function getLabelDef(id: string | null | undefined): ContentLabelDef {
  return isValidLabel(id)
    ? (CONTENT_LABELS.find((d) => d.id === id) as ContentLabelDef)
    : (CONTENT_LABELS.find((d) => d.id === DEFAULT_LABEL) as ContentLabelDef);
}

export interface LabelBadgeStyle {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

/**
 * Inline badge style derived from the label color: light tinted background,
 * deepened text and a soft border (mirrors the Badge warning variant which
 * uses color-mix on CSS custom properties).
 */
export function labelBadgeStyle(def: ContentLabelDef): LabelBadgeStyle {
  return {
    backgroundColor: `color-mix(in oklch, ${def.color} 14%, transparent)`,
    color: `color-mix(in oklch, ${def.color} 72%, black)`,
    borderColor: `color-mix(in oklch, ${def.color} 32%, transparent)`,
  };
}

/** Full-width / http(s)-only check for repost source URLs. */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}
