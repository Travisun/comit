import { sha256 } from "@/lib/auth/password";
import { consumeOneTimeKey, issueOneTimeKey } from "@/lib/auth/one-time";

/**
 * 联邦登录流程票据（OAuth2 `state` / Discourse SSO `nonce`）的服务端单次消费
 * 登记。cookie 只能证明「回调请求来自发起登录的同一浏览器」，无法证明
 * 「这条 URL 只被用过一次」——浏览器重放（预取/后退/中间代理重试）或服务端
 * 日志、Referer 泄露出去的完整回调 URL 都会带着仍然匹配的 cookie 值再来一次。
 * 这里把签发过的票据登记进一次性键存储（Redis → PG → 内存三级，见
 * src/lib/auth/one-time.ts），回调验证时原子消费：第二次使用同一票据直接按
 * 重放拒绝。
 */

/** 与承载 cookie 的 maxAge（600s）等长：两侧任一过期都判流程失效，语义一致。 */
const FLOW_TTL_SEC = 600;

export type FlowPurpose = "oauth_state" | "sso_nonce";

function flowKey(purpose: FlowPurpose, value: string): string {
  // 键位用 sha256 而非原值：一次性存储的键空间可能被运维/慢日志读到，
  // 不得顺带泄露仍然有效的登录票据。
  return `mb:otc:${purpose}:${sha256(value)}`;
}

/** 签发流程票据时登记（回调侧据此判重放）。 */
export async function issueFlowParam(purpose: FlowPurpose, value: string): Promise<void> {
  await issueOneTimeKey(flowKey(purpose, value), FLOW_TTL_SEC);
}

/**
 * 回调侧消费流程票据。true = 首次使用；false = 重放/已过期/从未由本站签发。
 */
export async function consumeFlowParam(purpose: FlowPurpose, value: string): Promise<boolean> {
  return consumeOneTimeKey(flowKey(purpose, value));
}
