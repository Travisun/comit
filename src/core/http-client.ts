import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "@/core/logger";

/**
 * 标准化出站 HTTP 客户端（D5，Laravel Http facade 对应物）—
 * 超时 + 重试（仅 GET/HEAD：网络错误与 5xx 重试，非幂等方法不重试）
 * + 可选 SSRF 防护 + 结构化日志。
 * LLM/OAuth/webhooks 等出站调用统一走这里。
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
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8 "this network"（含 0.0.0.0）
    a === 10 || // 10.0.0.0/8 私网
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT/运营商内部
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local（169.254.169.254 云 metadata）
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私网
    (a === 192 && b === 168) || // 192.168.0.0/16 私网
    (a === 192 && b === 0) || // 192.0.0.0/24 + 192.0.2.0/24 保留/TEST-NET
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 基准测试保留
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

/** 判定一个解析出的地址是否落在禁止访问的网段（IPv4/IPv6，含 v4-mapped v6） */
function isBlockedAddress(ip: string): boolean {
  // ::ffff:10.0.0.1 这类 IPv4-mapped IPv6 先还原成 IPv4 再判定
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const addr = mapped ? mapped[1] : ip;
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
  if (host.includes(":")) return isBlockedIpv6(host); // IPv6 字面量
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
