import http from "node:http";
import https from "node:https";
import { logger } from "@/core/logger";
import {
  bareHostname,
  isBlockedAddress,
  isForbiddenHostLiteral,
  literalIpFamily,
  lookupAddresses,
} from "@/core/ssrf";

// 网段判定/DNS 原语在 core/ssrf（保持既有对外导入路径不变）
export { isBlockedAddress, isForbiddenHostLiteral };

/**
 * 标准化出站 HTTP 客户端（D5，Laravel Http facade 对应物）—
 * 超时 + 重试（仅 GET/HEAD：网络错误与 5xx 重试，非幂等方法不重试）
 * + 可选 SSRF 防护 + 结构化日志。
 * LLM/OAuth/webhooks 等出站调用统一走这里。
 *
 * SSRF 防护（ssrfGuard=true）自 2026-09 起已闭环 DNS rebinding —— 不再是
 * 校验与实际连接之间留窗口的 best-effort：每跳只做**一次** DNS 解析，
 * 全部解析结果通过私网/保留段判定后，取该已校验 IP 作为本跳唯一连接目标
 * （node http/https 的自定义 `lookup` 直接返回它，连接阶段不再触发二次解析），
 * Host header 与 TLS SNI 仍保持原域名，虚拟主机/证书语义不受影响。
 * redirect 改为 manual 手动跟随：逐跳重新解析 + 重新校验 + 重新 pin（最多 3 跳）；
 * 幂等请求的重试同样每次重新走完整校验流程。
 * 已知边界：pinning 仅覆盖 ssrfGuard 路径（用户可控 URL：webhook 投递）；
 * 非 guarded 路径（LLM/OAuth 等运维配置的可信端点）仍走全局 fetch。
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
   * 请求前 DNS 解析并拒绝解析到 loopback/私网/link-local/保留地址的 URL，
   * 然后按已校验 IP 直连（IP pinning，杜绝二次解析 rebinding）；
   * redirect 改为 manual 手动跟随，每跳重新解析校验并重新 pin（最多 3 跳）。
   * 注意：该路径请求体仅支持字符串（webhook JSON 投递），响应体缓冲上限 2 MiB。
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
/** ssrfGuard 路径响应体缓冲上限（防超大响应打爆投递进程内存） */
const MAX_PINNED_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 统一 fetch 路径与 pinned 路径的内部响应形态 */
interface OutboundResponse {
  status: number;
  headers: Headers;
  /** 惰性读取（整个响应只允许消费一次，与 fetch 语义一致） */
  text(): Promise<string>;
  /** 放弃消费时释放上游连接 */
  cancel(): void;
}

/** 校验并 pin 的目标：解析 + 逐地址判定 + 选定唯一连接 IP */
interface PinnedTarget {
  url: URL;
  /** 已校验、实际建立 socket 连接的唯一 IP（字面量 URL 时即字面量本身） */
  address: string;
  family: 4 | 6;
}

/**
 * 解析 + 校验 + 选 pin IP（每跳唯一一次 DNS 解析）：
 * 仅允许 http(s)；域名解析出的**所有**地址都必须是公网地址（任一命中
 * 私网/保留段即拒绝），随后取第一个已校验地址作为连接目标。
 * 解析失败/无结果 fail closed。后续连接阶段经自定义 lookup 直接复用该
 * address，不再触发系统解析 —— 校验与连接之间不存在二次解析窗口。
 */
async function resolvePinnedTarget(raw: string): Promise<PinnedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SSRF guard: invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`SSRF guard: only http(s) URLs are allowed: ${raw}`);
  }
  const host = bareHostname(url.hostname);
  let addrs: { address: string }[];
  const literalFamily = literalIpFamily(host);
  if (literalFamily) {
    addrs = [{ address: host }]; // IP 字面量无需解析
  } else {
    try {
      addrs = await lookupAddresses(host);
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
  const pinned = addrs[0].address;
  return { url, address: pinned, family: literalFamily || (isIPFamily6(pinned) ? 6 : 4) };
}

function isIPFamily6(address: string): boolean {
  return address.includes(":");
}

/**
 * 按已校验 IP 直连的请求执行（本跳唯一一次 socket 建立）。
 *
 * IP pinning 实现：node http/https 的 `lookup` 选项覆盖连接阶段的 DNS 解析
 * —— 直接回调已校验 IP，网络层永不接触系统解析器；`host` 保持原始域名，
 * 因此 Host header 与 https 的 servername（SNI）均按原域名发送，
 * 虚拟主机路由与证书校验语义不变。
 */
function pinnedRequest(
  target: PinnedTarget,
  reqOpts: {
    method?: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    signal: AbortSignal;
  },
): Promise<OutboundResponse> {
  const { url, address, family } = target;
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  return new Promise<OutboundResponse>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    // IP pinning：连接阶段不再解析 DNS，唯一事实来源是已校验的 address。
    // 兼容 node 内部两种调用形态（autoSelectFamily 路径会以 all:true 要求数组）。
    const pinnedLookup = (
      _hostname: string,
      options: unknown,
      callback?: unknown,
    ) => {
      const cb = typeof options === "function" ? options : callback;
      if (typeof cb !== "function") return;
      if (typeof options === "object" && options !== null && (options as { all?: boolean }).all) {
        (cb as (err: Error | null, addresses?: { address: string; family: number }[]) => void)(null, [
          { address, family },
        ]);
      } else {
        (cb as (err: Error | null, address?: string, family?: number) => void)(null, address, family);
      }
    };
    const req = lib.request(
      {
        host: url.hostname, // 原始域名（含 v6 方括号）→ Host header / SNI 语义
        port,
        path: `${url.pathname}${url.search}`,
        method: reqOpts.method ?? "GET",
        headers: reqOpts.headers,
        timeout: reqOpts.timeoutMs,
        signal: reqOpts.signal, // 外层 AbortController 统一超时
        ...(isHttps ? { servername: bareHostname(url.hostname) } : {}),
        lookup: pinnedLookup as unknown as typeof import("node:dns").lookup,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PINNED_RESPONSE_BYTES) {
            res.destroy();
            fail(new Error(`SSRF guard: response body exceeds ${MAX_PINNED_RESPONSE_BYTES} bytes: ${url.href}`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", (err: Error) => fail(err));
        res.on("end", () => {
          if (settled) return;
          settled = true;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
          }
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers: new Headers(headers),
            text: async () => body,
            cancel: () => {},
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`SSRF guard: request timed out after ${reqOpts.timeoutMs}ms: ${url.href}`));
    });
    req.on("error", (err: Error) => fail(err));
    req.end(reqOpts.body);
  });
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
  // 仅幂等方法重试：网络错误与 5xx 各计一次预算；非幂等方法不重试
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
      const reqHeaders: Record<string, string> = {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      };

      // ssrfGuard：redirect 改手动跟随，每跳「解析+校验+pin」恰好一次 DNS 解析；
      // 普通请求交给 fetch 自动跟随。
      for (let hop = 0; ; hop++) {
        let res: OutboundResponse;
        if (ssrfGuard) {
          // resolvePinnedTarget 是本跳唯一一次解析；pinnedRequest 直连其结果 IP。
          // 校验通过后即使 attacker TTL 到期返回新 IP 也不再生效（不再有第二次解析）。
          const target = await resolvePinnedTarget(currentUrl);
          const hasBody = currentMethod !== "GET" && currentMethod !== "HEAD" && currentBody !== undefined;
          if (hasBody && typeof currentBody !== "string") {
            throw new Error("SSRF guard: pinned path supports string request bodies only");
          }
          res = await pinnedRequest(target, {
            method: currentMethod,
            headers: reqHeaders,
            body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : (currentBody as string | undefined),
            timeoutMs,
            signal: controller.signal,
          });
        } else {
          const fetched = await fetch(currentUrl, {
            method: currentMethod,
            signal: controller.signal,
            redirect: "follow",
            headers: reqHeaders,
            body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
          });
          res = {
            status: fetched.status,
            headers: fetched.headers,
            text: () => fetched.text(),
            cancel: () => {
              fetched.body?.cancel().catch(() => {}); // 释放未消费的连接
            },
          };
        }

        if (ssrfGuard && REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get("location");
          res.cancel();
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
          continue; // 下一跳重新「解析+校验+pin」
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
          res.cancel();
          attempt += 1;
          log.warn("http.out.retry", { label, url: currentUrl, method: currentMethod, status: res.status, attempt });
          await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** (attempt - 1)));
          break;
        }

        let consumed: string | null = null;
        const read = async (): Promise<string> => {
          if (consumed === null) consumed = await res.text();
          return consumed;
        };
        return {
          ok: res.status >= 200 && res.status <= 299,
          status: res.status,
          headers: res.headers,
          json: async () => JSON.parse(await read()) as T,
          text: read,
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
