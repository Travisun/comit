/**
 * Verification (V badge) domain: type catalog, shared view models and the
 * request schema. This module is intentionally **dependency-free** (no db, no
 * server-only imports) so client components — VerifiedBadge, the settings
 * panel, the admin console — can reuse the constants. The db-backed queries
 * and review transactions live in `./verification.server`.
 */

export type VerificationType = "personal" | "creator" | "professional" | "organization";
export type VerificationRequestStatus = "pending" | "approved" | "rejected";

export interface Bilingual {
  zh: string;
  en: string;
}

export interface VerificationTypeInfo {
  id: VerificationType;
  name: Bilingual;
  desc: Bilingual;
  /** catalog icon key — resolved to a lucide icon on the client */
  icon: "user" | "pen" | "briefcase" | "building";
}

/** The four verification tracks. Order = display order. */
export const VERIFICATION_TYPES: VerificationTypeInfo[] = [
  {
    id: "personal",
    name: { zh: "个人认证", en: "Personal" },
    desc: { zh: "实名/身份类认证", en: "Identity verification" },
    icon: "user",
  },
  {
    id: "creator",
    name: { zh: "创作者认证", en: "Creator" },
    desc: { zh: "持续产出优质内容", en: "Quality content creator" },
    icon: "pen",
  },
  {
    id: "professional",
    name: { zh: "职业认证", en: "Professional" },
    desc: { zh: "职业资质/公司职位", en: "Professional credential" },
    icon: "briefcase",
  },
  {
    id: "organization",
    name: { zh: "机构认证", en: "Organization" },
    desc: { zh: "企业/团队/组织号", en: "Organization account" },
    icon: "building",
  },
];

export const VERIFICATION_TYPE_IDS = VERIFICATION_TYPES.map((t) => t.id) as VerificationType[];

/** Fast lookup by type id (unknown ids → undefined; callers must fall back). */
export const VERIFICATION_TYPE_MAP: Record<string, VerificationTypeInfo> = Object.fromEntries(
  VERIFICATION_TYPES.map((t) => [t.id, t]),
);

/**
 * Badge visual config for `BadgeCheck` (lucide): the badge shape is filled
 * with the track color while the check stroke stays white — Weibo/Bilibili
 * style V mark. Colors: personal 蓝 / creator 紫 / professional 青绿 /
 * organization 金.
 */
export const VERIFICATION_BADGE_STYLES: Record<string, { fill: string; chip: string; card: string }> = {
  personal: {
    fill: "fill-blue-500 text-white",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    card: "border-blue-500/30 bg-blue-500/5",
  },
  creator: {
    fill: "fill-purple-500 text-white",
    chip: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
    card: "border-purple-500/30 bg-purple-500/5",
  },
  professional: {
    fill: "fill-teal-500 text-white",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
    card: "border-teal-500/30 bg-teal-500/5",
  },
  organization: {
    fill: "fill-amber-500 text-white",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    card: "border-amber-500/30 bg-amber-500/5",
  },
};

/** Fallback style for unknown/legacy types. */
export const VERIFICATION_BADGE_FALLBACK = {
  fill: "fill-sky-500 text-white",
  chip: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  card: "border-sky-500/30 bg-sky-500/5",
};

/** Upgrade graph: which tracks a verified account may re-apply for. */
export const VERIFICATION_UPGRADE_PATHS: Partial<Record<string, readonly VerificationType[]>> = {
  personal: ["creator", "professional", "organization"],
  creator: ["professional", "organization"],
  professional: ["organization"],
  organization: [],
};

/** Types a user with `currentType` may upgrade to (empty for unknown types). */
export function verificationUpgradeTargets(currentType: string | null | undefined): VerificationType[] {
  if (!currentType) return [...VERIFICATION_TYPE_IDS];
  return [...(VERIFICATION_UPGRADE_PATHS[currentType] ?? [])];
}

export function verificationTypeName(type: string, locale: "zh" | "en"): string {
  const info = VERIFICATION_TYPE_MAP[type];
  if (!info) return type;
  return locale === "en" ? info.name.en : info.name.zh;
}

/* ------------------------------ view models ------------------------------ */

/** `users.verified` jsonb shape. */
export interface VerificationBadge {
  type: string;
  label: string;
  approvedAt: string; // ISO
}

/** One row of verification_requests, serialized for the client. */
export interface VerificationRequestView {
  id: string;
  type: string;
  label: string;
  description: string;
  attachments: string[];
  status: VerificationRequestStatus;
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Review-console row: request + applicant identity/badge context. */
export interface AdminVerificationRequestView extends VerificationRequestView {
  userId: string;
  user: {
    username: string;
    displayName: string;
    avatarPath: string | null;
    tier: number;
    verified: VerificationBadge | null;
  };
}

/** GET /api/me/verification payload. */
export interface VerificationMeResponse {
  verified: VerificationBadge | null;
  /** latest pending request, else the most recent request (may be rejected) */
  activeRequest: VerificationRequestView | null;
  types: VerificationTypeInfo[];
  myRequests: VerificationRequestView[];
}

/* ------------------------------- validation ------------------------------ */

import { z } from "zod";

/** Shared POST /api/me/verification body schema. */
export const createVerificationRequestSchema = z.object({
  type: z.enum(VERIFICATION_TYPE_IDS as [VerificationType, ...VerificationType[]]),
  label: z
    .string()
    .trim()
    .min(2, "认证名称至少 2 个字 / Label must be at least 2 characters")
    .max(80, "认证名称过长 / Label too long"),
  description: z
    .string()
    .trim()
    .min(10, "请填写至少 10 个字的说明 / Description must be at least 10 characters")
    .max(500, "说明过长 / Description too long"),
  attachments: z
    .array(z.string().min(1))
    .min(1, "请至少上传 1 张证明材料 / At least 1 attachment required")
    .max(3, "最多上传 3 张证明材料 / At most 3 attachments"),
});
export type CreateVerificationRequestInput = z.infer<typeof createVerificationRequestSchema>;
