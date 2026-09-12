/**
 * Membership tiers (VIP groups) — data +文案 only for now; **no upgrade UI**
 * ships with this module. It exists so future paid upgrades can plug in
 * without touching call sites:
 *
 *   升级路径（预留，主流程尚未接入）：
 *   支付插件（Stripe/虎皮椒等）→ 回调校验 → 更新 `users.tier`
 *   → emit(`user:tier.changed`) → 各处限额即时生效。
 *
 * 限额读取统一走 {@link applyTierLimits}：先取该等级的基础限额，再依次套用
 * `tierHooks.resolveLimits` 中注册的钩子。未来付费插件只需
 * `registerTierLimitHook((tierId, limits) => ({ ...limits, maxMediaMb: 4096 }))`
 * 即可改写任意限额，无需改动业务代码。
 *
 * TODO(主代集成)：`src/lib/auth/invite.ts` 的 `MAX_INVITES_PER_USER` 常量
 * 应替换为 `applyTierLimits(user.tier).limits.maxInvites`（创建邀请码时按
 * 用户当前 tier 计算），媒体上传的体积上限同理。
 */

export interface Bilingual {
  zh: string;
  en: string;
}

export interface TierLimits {
  /** max concurrently-unused invite codes */
  maxInvites: number;
  /** per-image upload cap in MB */
  maxMediaMb: number;
  /** video upload gate — flipped on when the media pipeline supports it */
  canUploadVideoSoon: boolean;
  /** priority human support */
  prioritySupport: boolean;
}

export interface TierDef {
  id: number;
  name: Bilingual;
  /** free tiers need no payment */
  free: boolean;
  limits: TierLimits;
  note: Bilingual;
}

/** The tier catalog. Tier 1 is the default free tier; higher tiers are reserved. */
export const TIERS: TierDef[] = [
  {
    id: 1,
    name: { zh: "VIP 1 · 标准", en: "VIP 1 · Standard" },
    free: true,
    limits: { maxInvites: 5, maxMediaMb: 200, canUploadVideoSoon: false, prioritySupport: false },
    note: { zh: "注册即享的基础权益", en: "Default benefits for every account" },
  },
  {
    id: 2,
    name: { zh: "VIP 2 · 进阶", en: "VIP 2 · Plus" },
    free: false,
    limits: { maxInvites: 15, maxMediaMb: 1024, canUploadVideoSoon: true, prioritySupport: false },
    note: { zh: "为未来付费升级预留", en: "Reserved for a future paid upgrade" },
  },
  {
    id: 3,
    name: { zh: "VIP 3 · 尊享", en: "VIP 3 · Pro" },
    free: false,
    limits: { maxInvites: 50, maxMediaMb: 4096, canUploadVideoSoon: true, prioritySupport: true },
    note: { zh: "为未来付费升级预留", en: "Reserved for a future paid upgrade" },
  },
];

export const DEFAULT_TIER_ID = 1;

/** Resolve a tier def; unknown ids (or legacy rows) fall back to tier 1. */
export function getTier(tierId: number | null | undefined): TierDef {
  return TIERS.find((t) => t.id === tierId) ?? TIERS[0];
}

/** Short UI label, e.g. "VIP 1". */
export function tierLabel(tierId: number | null | undefined): string {
  return `VIP ${getTier(tierId).id}`;
}

export type TierLimitHook = (tierId: number, limits: TierLimits) => TierLimits;

/**
 * Plugin hook registry. Payment/booster plugins push resolvers here at boot;
 * {@link applyTierLimits} folds them in registration order.
 */
export const tierHooks = {
  resolveLimits: [] as TierLimitHook[],
};

/** Convenience wrapper so plugins do not touch the array directly. */
export function registerTierLimitHook(hook: TierLimitHook): () => void {
  tierHooks.resolveLimits.push(hook);
  return () => {
    const i = tierHooks.resolveLimits.indexOf(hook);
    if (i >= 0) tierHooks.resolveLimits.splice(i, 1);
  };
}

/**
 * Effective limits for a tier: base catalog limits, then every registered
 * hook. Always use this (never read `TIERS[].limits` directly) so plugins can
 * override.
 */
export function applyTierLimits(tierId: number | null | undefined): TierLimits {
  const tier = getTier(tierId);
  let limits = { ...tier.limits };
  for (const hook of tierHooks.resolveLimits) {
    limits = hook(tier.id, limits);
  }
  return limits;
}
