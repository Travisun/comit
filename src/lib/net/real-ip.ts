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

/**
 * IP 形状防御：x-real-ip / cf-connecting-ip / XFF 选中跳在接受前先做格式
 * 校验。nginx 默认**不会**剥除入站 X-Real-IP，直连形态下该头可被任意伪造 ——
 * 无校验时攻击者每请求换一个垃圾值即可让所有按 IP 的限流桶全部失效，且
 * 任意字符串成为限流键后还会放大内存降级表的驱逐（挤掉合法用户的桶）。
 * 宽松匹配（IPv4 点分 / IPv6 含冒号的十六进制串，≤45 字符）即可区分
 * "长得像 IP"与"纯垃圾"，不必做完整 RFC 解析。
 */
export function isPlausibleIp(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 45) return false;
  if (v.includes(":")) {
    // IPv6（含映射形式 ::ffff:1.2.3.4）：只允许十六进制与分隔符
    return /^[0-9a-fA-F:.]+$/.test(v) && (v.match(/:/g)?.length ?? 0) >= 2;
  }
  // IPv4：恰好 4 段 0-255
  const parts = v.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * XFF 语义：每个代理追加"它所看到的对端地址"。因此最右 trustedCount 跳是
 * 受信代理链追加的地址（最右 = 最末代理看到的对端），客户端 IP 在第
 * `length - trustedCount` 位；伪造头会被挤到更左侧而被忽略。
 * 跳数不足（全部为受信代理）或 trustedCount=0（XFF 整体不受信）→ null。
 */
function pickFromXff(xff: string, trustedCount: number): string | null {
  const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
  const idx = hops.length - trustedCount;
  if (idx < 0) return null;
  const hop = hops[idx] || "";
  // 受信代理链正常只追加合法 IP；格式不符视为不可信输入，回退 UNKNOWN
  return isPlausibleIp(hop) ? hop : null;
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
    if (cf && isPlausibleIp(cf)) return cf.trim();
    // CF → Nginx 双层：回退 nginx 链路
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp && isPlausibleIp(realIp)) return realIp.trim();

  const rawCount = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);
  const trustedCount = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : 1;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return pickFromXff(xff, trustedCount) ?? UNKNOWN_IP;

  return UNKNOWN_IP;
}
