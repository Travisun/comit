import type { User } from "@/db/schema";
import { forbidden } from "@/core/errors";

/**
 * Policy（Laravel Gate 对应物）— 命名能力的授权判断。
 * 核心为内置能力注册默认策略（如 post.update = 作者本人）；
 * 扩展可注册自己的能力，也可在同一能力上追加策略（全部通过才放行，
 * 如「协作编辑」扩展追加协作者策略）。未注册策略的能力一律拒绝（显式注册）。
 */

export interface PolicyUser {
  id: string;
  role: string;
}

export interface PolicyDecision {
  allowed: boolean;
  message?: string;
}

export type PolicyResult = boolean | PolicyDecision;

export type PolicyHandler = (user: PolicyUser, target: unknown) => PolicyResult | Promise<PolicyResult>;

const g = globalThis as unknown as { __mbPolicies?: Map<string, PolicyHandler[]> };
const policies: Map<string, PolicyHandler[]> = (g.__mbPolicies ??= new Map());

/** 注册能力策略 — 同一能力可叠加多个策略（AND 语义）。 */
export function registerPolicy(ability: string, fn: PolicyHandler): void {
  const list = policies.get(ability) ?? [];
  list.push(fn);
  policies.set(ability, list);
}

/** 是否具备能力 — 全部已注册策略通过才算通过；未注册 ⇒ 拒绝。 */
export async function can(
  user: PolicyUser | null,
  ability: string,
  target?: unknown,
): Promise<boolean> {
  const list = policies.get(ability);
  if (!list || list.length === 0 || !user) return false;
  for (const fn of list) {
    const result = await fn(user, target);
    if (!(typeof result === "boolean" ? result : result.allowed)) return false;
  }
  return true;
}

/** 授权断言 — 不通过抛 403，message 取首个拒绝策略的说明。 */
export async function authorize(user: User | null, ability: string, target?: unknown): Promise<void> {
  if (!user) throw forbidden("请先登录 / Sign in required");
  const list = policies.get(ability);
  if (!list || list.length === 0) {
    throw forbidden(`未定义的能力 / Unknown ability: ${ability}`);
  }
  for (const fn of list) {
    const result = await fn({ id: user.id, role: user.role }, target);
    if (typeof result === "boolean") {
      if (!result) throw forbidden("没有权限 / Forbidden");
    } else if (!result.allowed) {
      throw forbidden(result.message ?? "没有权限 / Forbidden");
    }
  }
}
