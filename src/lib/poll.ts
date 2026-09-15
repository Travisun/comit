/**
 * 投票规则 — 客户端（composer 面板）与服务端（API 校验）共用，保持单一来源。
 * 选项长度按「书写权重」计：一个 CJK 字符记 2，其他字符记 1 ——
 * 即最多 16 个汉字或 32 个英文字符（混输按权重折算）。
 * 视图模型（PollView）的 schema 在 src/lib/models/poll.ts。
 */

export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 5;
export const POLL_OPTION_MAX_WEIGHT = 32;
/** 投票最长持续 30 天 */
export const POLL_MAX_DURATION_DAYS = 30;

export type PollMode = "single" | "multiple";

export function isCjkChar(ch: string): boolean {
  return /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch);
}

export function pollOptionWeight(s: string): number {
  let w = 0;
  for (const ch of s) w += isCjkChar(ch) ? 2 : 1;
  return w;
}

/** 校验一组选项：数量 2–5、非空、权重 ≤32；返回首个错误的用户可读文案。 */
export function validatePollOptions(
  options: string[],
  zh = true,
): string | null {
  const cleaned = options.map((o) => o.trim());
  if (cleaned.length < POLL_OPTIONS_MIN || cleaned.length > POLL_OPTIONS_MAX) {
    return zh
      ? `投票需要 ${POLL_OPTIONS_MIN}-${POLL_OPTIONS_MAX} 个选项`
      : `Polls need ${POLL_OPTIONS_MIN}-${POLL_OPTIONS_MAX} options`;
  }
  for (const o of cleaned) {
    if (!o) return zh ? "选项不能为空" : "Options cannot be empty";
    if (pollOptionWeight(o) > POLL_OPTION_MAX_WEIGHT) {
      return zh
        ? `每个选项最多 ${POLL_OPTION_MAX_WEIGHT / 2} 个汉字或 ${POLL_OPTION_MAX_WEIGHT} 个英文字符`
        : `Each option is limited to ${POLL_OPTION_MAX_WEIGHT / 2} CJK or ${POLL_OPTION_MAX_WEIGHT} latin characters`;
    }
  }
  return null;
}

/** 截止时间必须在未来、不超过最长持续期；返回错误文案或 null。 */
export function validatePollEndsAt(endsAt: Date, zh = true): string | null {
  const now = Date.now();
  const t = endsAt.getTime();
  if (!Number.isFinite(t) || t <= now) {
    return zh ? "投票结束时间必须晚于现在" : "Poll end must be in the future";
  }
  if (t - now > POLL_MAX_DURATION_DAYS * 86_400_000) {
    return zh
      ? `投票最长持续 ${POLL_MAX_DURATION_DAYS} 天`
      : `Polls can run at most ${POLL_MAX_DURATION_DAYS} days`;
  }
  return null;
}

export type { PollView } from "@/lib/models/poll";
