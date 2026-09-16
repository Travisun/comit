import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "@/core/logger";

/**
 * 标准化出站 HTTP 客户端（D5，Laravel Http facade 对应物）—
 * 超时 + 重试（仅 GET/HEAD：网络错误与 5xx 重试，非幂等方法不重试）
 * + 可选 SSRF 防护 + 结构化日志。
 * LLM/OAuth/webhooks 等出站调用统一走这里。
 *
 * 已知边界：SSRF 防护对 DNS rebinding 是 best-effort —— 校验与实际连接
 * 存在两次解析之间的窗口，完整闭环需 undici dispatcher 按已校验 IP 固定
 * 连接（后续项）。
 */

export interface HttpRequestOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** JSON body（自动序列化 + Content-Type）；与 body 互斥 */
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** 请求日志标签 */
  label?: string;
  /**
   * SSRF 防护（默认关闭；仅在处理用户可控 URL 的出站启用，如 webhook 投递）—
   * 请求前 DNS 解析并拒绝解析到 loopback/私网/link-local/保留地址的 URL；
   * redirect 改为 manual 手动跟随，每跳重新校验（最多 3 跳）。
   */
  ssrfGuard?: boolean;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<T>;
  text(): Promise<string>;
}

const log = logger.child({ module: "http" });

/** ssrfGuard 下允许的最大重定向跳数 */
const MAX_REDIRECT_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || // 0.0.0.0/8 "this network"（含 0.0.0.0）
    a === 10 || // 10.0.0.0/8 私网
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT/运营商内部
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local（169.254.169.254 云 metadata）
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私网
    (a === 192 && b === 168) || // 192.168.0.0/16 私网
    // 原 /16 全拦过宽，精确到两个特殊 /24（安全方向宁可过拦的其余段已放行）：
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24 IETF 协议分配 + 192.0.2.0/24 TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 relay anycast（RFC 7526 已废弃）
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 基准测试保留
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 TEST-NET-3
    a >= 224 // 组播/保留（224/4、240/4、255.255.255.255）
  );
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  return (
    addr === "::" || // unspecified
    addr === "::1" || // loopback
    /^f[cd]/.test(addr) || // fc00::/7 unique local
    /^fe[89ab]/.test(addr) || // fe80::/10 link-local
    /^fe[cdef]/.test(addr) || // fec0::/12 已废弃的 site-local（历史私网段，防御性拦截）
    /^ff/.test(addr) // ff00::/8 multicast
  );
}

/**
 * 将 IPv6 地址展开为 8 个 hextet（0-65535）；支持 :: 压缩与点分 IPv4 尾段
 * （如 ::ffff:1.2.3.4 先折算成两个 hextet）。非法/无法解析返回 null。
 */
function expandIpv6Hextets(addr: string): number[] | null {
  let s = addr;
  // 点分 IPv4 尾段 → 两个 hextet（十六进制），统一后续解析
  const v4Tail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const o = v4Tail[2].split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = `${v4Tail[1]}${(((o[0] << 8) | o[1]) >>> 0).toString(16)}:${(((o[2] << 8) | o[3]) >>> 0).toString(16)}`;
  }
  const sections = s.split("::");
  if (sections.length > 2) return null; // 至多一个 ::
  const head = sections[0] ? sections[0].split(":") : [];
  const tail = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  if (sections.length === 1 && head.length !== 8) return null; // 无压缩必须恰好 8 段
  const hextet = /^[0-9a-f]{1,4}$/;
  if (!head.every((h) => hextet.test(h)) || !tail.every((h) => hextet.test(h))) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<string>(fill).fill("0"), ...tail].map((h) => parseInt(h, 16));
}

/**
 * 内嵌 IPv4 归一化：把最后 32 位为嵌入 IPv4 的 IPv6 还原成点分 IPv4 —
 * 覆盖 ::ffff:x（v4-mapped，点分或十六进制尾段，如 ::ffff:a00:1）、
 * ::x（v4-compatible，如 ::7f00:1）、64:ff9b::x（NAT64，RFC 6052）。
 * 非（或非法）该形式返回 null，交回原 IPv6 判定逻辑。
 */
function unwrapEmbeddedIpv4(addr: string): string | null {
  const hextets = expandIpv6Hextets(addr.toLowerCase());
  if (!hextets) return null;
  const [h0, h1, h2, h3, h4, h5] = hextets;
  const mapped = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff; // ::ffff:0:0/96
  const compatible = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0; // ::/96
  const nat64 = h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0; // 64:ff9b::/96
  if (!mapped && !compatible && !nat64) return null;
  const [hi, lo] = [hextets[6], hextets[7]];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** 判定一个解析出的地址是否落在禁止访问的网段（IPv4/IPv6，含内嵌 IPv4 的各类 v6 形式） */
function isBlockedAddress(ip: string): boolean {
  // ::ffff:a00:1 / ::7f00:1 / 64:ff9b::a00:1 这类先还原成 IPv4 再判定
  const addr = unwrapEmbeddedIpv4(ip) ?? ip.toLowerCase();
  return addr.includes(":") ? isBlockedIpv6(addr) : isBlockedIpv4(addr);
}

/**
 * SSRF 校验：仅允许 http(s)，域名经 DNS 解析后所有地址都必须是公网地址。
 * 解析失败视为不安全（fail closed）。注意这是 best-effort：校验与实际连接
 * 之间存在 DNS rebinding 窗口（fetch 会再次解析），完整防护需按已校验 IP
 * 固定连接（undici 自定义 dispatcher），此处以「每跳/每次尝试重新解析」收窄窗口。
 */
async function assertUrlSafeForSsrf(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SSRF guard: invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`SSRF guard: only http(s) URLs are allowed: ${raw}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  if (isIP(host)) {
    addrs = [{ address: host }]; // IP 字面量无需解析
  } else {
    try {
      addrs = await lookup(host, { all: true });
    } catch {
      throw new Error(`SSRF guard: DNS lookup failed for ${host}`);
    }
  }
  if (addrs.length === 0) throw new Error(`SSRF guard: no addresses resolved for ${host}`);
  for (const { address } of addrs) {
    if (isBlockedAddress(address)) {
      throw new Error(`SSRF guard: ${host} resolves to a forbidden address (${address})`);
    }
  }
}

/**
 * 同步版主机字面量检查（不做 DNS；用于创建 webhook 时的快速反馈，
 * 权威校验在 ssrfGuard 的 DNS 解析）。域名一律放行 → 投递时兜底。
 */
export function isForbiddenHostLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  // IPv6 字面量走 isBlockedAddress：与投递时权威判定同源（含内嵌 IPv4 还原）
  if (host.includes(":")) return isBlockedAddress(host);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isBlockedIpv4(host); // IPv4 字面量
  return false;
}

export async function httpRequest<T = unknown>(
  url: string,
  opts: HttpRequestOptions = {},
): Promise<HttpResponse<T>> {
  const {
    method = "GET",
    headers = {},
    json,
    body,
    timeoutMs = 15_000,
    retries = 1,
    retryDelayMs = 400,
    label,
    ssrfGuard = false,
  } = opts;
  // 仅幂等方法重试：网络错误与 5xx 各计一次预算；非幂等方法永不重试
  const idempotent = method === "GET" || method === "HEAD";
  const maxAttempts = 1 + (idempotent ? retries : 0);
  const started = Date.now();
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = url;
      let currentMethod: HttpRequestOptions["method"] = method;
      let currentBody: BodyInit | string | undefined = json !== undefined ? JSON.stringify(json) : body;

      // ssrfGuard：redirect 改手动跟随，逐跳重新校验（普通请求交给 fetch 自动跟随）
      for (let hop = 0; ; hop++) {
        if (ssrfGuard) await assertUrlSafeForSsrf(currentUrl);
        const res = await fetch(currentUrl, {
          method: currentMethod,
          signal: controller.signal,
          redirect: ssrfGuard ? "manual" : "follow",
          headers: {
            ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
            ...headers,
          },
          body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
        });

        if (ssrfGuard && REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get("location");
          res.body?.cancel().catch(() => {}); // 释放未消费的连接
          if (!location) throw new Error(`SSRF guard: redirect ${res.status} without Location: ${currentUrl}`);
          if (hop >= MAX_REDIRECT_HOPS) {
            throw new Error(`SSRF guard: too many redirects (> ${MAX_REDIRECT_HOPS}) starting at ${url}`);
          }
          const next = new URL(location, currentUrl).href;
          log.info("http.out.redirect", { label, from: currentUrl, to: next, status: res.status, hop: hop + 1 });
          // 301/302/303 → GET 并丢弃 body（浏览器语义）；307/308 保留 method+body
          if (res.status !== 307 && res.status !== 308) {
            currentMethod = "GET";
            currentBody = undefined;
          }
          currentUrl = next;
          continue; // 下一跳重新过 SSRF 校验
        }

        log.info("http.out", {
          label,
          url: currentUrl,
          method: currentMethod,
          status: res.status,
          attempt,
          ms: Date.now() - started,
        });

        // GET/HEAD 的 5xx 计入重试预算（其他方法/状态直接返回）
        if (res.status >= 500 && attempt + 1 < maxAttempts) {
          res.body?.cancel().catch(() => {});
          attempt += 1;
          log.warn("http.out.retry", { label, url: currentUrl, method: currentMethod, status: res.status, attempt });
          await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** (attempt - 1)));
          break;
        }

        return {
          ok: res.ok,
          status: res.status,
          headers: res.headers,
          json: () => res.json() as Promise<T>,
          text: () => res.text(),
        };
      }
    } catch (err) {
      lastError = err;
      attempt += 1;
      // 超时（AbortError）不重试；仅幂等方法且还有预算才重试
      const retriable = idempotent && err instanceof Error && err.name !== "AbortError" && attempt < maxAttempts;
      log.warn("http.out.failed", {
        label,
        url,
        method,
        attempt,
        retriable,
        err,
      });
      if (!retriable) break;
      await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`HTTP request failed: ${url}`);
}
