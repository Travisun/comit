import { logger } from "@/core/logger";

/**
 * 标准化出站 HTTP 客户端（D5，Laravel Http facade 对应物）—
 * 超时 + 重试（指数退避，仅幂等方法/5xx/网络错误）+ 结构化日志。
 * LLM/OAuth/webhooks 等出站调用统一走这里。
 */

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** JSON body（自动序列化 + Content-Type）；与 body 互斥 */
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** 请求日志标签 */
  label?: string;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<T>;
  text(): Promise<string>;
}

const log = logger.child({ module: "http" });

export async function httpRequest<T = unknown>(
  url: string,
  opts: HttpRequestOptions = {},
): Promise<HttpResponse<T>> {
  const { method = "GET", headers = {}, json, body, timeoutMs = 15_000, retries = 1, retryDelayMs = 400, label } = opts;
  const started = Date.now();
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : body,
      });
      log.info("http.out", {
        label,
        url,
        method,
        status: res.status,
        attempt,
        ms: Date.now() - started,
      });
      return {
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        json: () => res.json() as Promise<T>,
        text: () => res.text(),
      };
    } catch (err) {
      lastError = err;
      attempt += 1;
      const retriable = err instanceof Error && err.name === "AbortError" ? false : attempt <= retries;
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
