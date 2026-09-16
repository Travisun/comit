/**
 * Real client IP resolution（真实客户端 IP 解析）— 部署形态感知的 HTTP 头优先级与回退。
 *
 * 由 `TRUST_PROXY` 环境变量选择部署形态（进程启动时打一条日志说明当前模式）：
 *  - `nginx`（默认）：信任 Nginx 反代 —— `X-Real-IP` 优先，其次 `X-Forwarded-For`
 *    从右往左跳过 TRUSTED_PROXY_COUNT 个受信代理（默认 1）后取第一个不受信跳；
 *  - `cloudflare`：信任 Cloudflare —— `CF-Connecting-IP` 优先（回退 nginx 链路，
 *    兼容"CF → Nginx → 应用"双层代理）；
 *  - `direct`：不信任任何代理头（直连对外时这些头可被任意伪造）。Web Request
 *    无法拿到对端 socket 地址，此模式下返回 UNKNOWN，限流等场景自动退化为
 *    无 IP 维度的粗粒度键（安全优先于可用性，见 rate-limit 的 IP 键策略）。
 *
 * 安全前提：模式必须与真实部署一致 —— 声称 cloudflare/nginx 而实际直连时，
 * 攻击者可伪造对应头冒充任意 IP 绕过限流/污染审计。
 */

const g = globalThis as unknown as { __mbRealIpModeLogged?: boolean };

export type TrustProxyMode = "nginx" | "cloudflare" | "direct";

export function trustProxyMode(): TrustProxyMode {
  const raw = (process.env.TRUST_PROXY ?? "nginx").toLowerCase();
  return raw === "cloudflare" || raw === "direct" ? (raw as TrustProxyMode) : "nginx";
}

export const UNKNOWN_IP = "unknown";

/** XFF 从右往左跳过 count 个受信代理后取第一个不受信跳（无则返回 null）。 */
function pickFromXff(xff: string, trustedCount: number): string | null {
  const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
  // 最右 trustedCount 跳是代理自身，客户端 IP 在其左侧
  const idx = hops.length - 1 - trustedCount;
  return idx >= 0 ? (hops[idx] || null) : null;
}

/**
 * Best-effort 真实客户端 IP，用于限流键 / 审计 / 错误上报归因。
 * 始终返回一个非空字符串（取不到返回 UNKNOWN_IP），调用方无需判空。
 */
export function clientIp(req: Request): string {
  const mode = trustProxyMode();
  if (!g.__mbRealIpModeLogged) {
    // 只打一次：让运维能在日志里确认生效模式与部署假设一致
    g.__mbRealIpModeLogged = true;
    console.info(`[real-ip] TRUST_PROXY=${mode} (trusted proxies: ${process.env.TRUSTED_PROXY_COUNT ?? 1})`);
  }

  if (mode === "direct") return UNKNOWN_IP;

  if (mode === "cloudflare") {
    const cf = req.headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    // CF → Nginx 双层：回退 nginx 链路
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const trustedCount = Math.max(0, Number(process.env.TRUSTED_PROXY_COUNT ?? 1) || 1);
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return pickFromXff(xff, trustedCount) ?? UNKNOWN_IP;

  return UNKNOWN_IP;
}
