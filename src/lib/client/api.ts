"use client";

/**
 * 全局客户端 fetch 层 — 所有浏览器端数据访问的唯一入口。
 *
 * 约定（与服务端 `src/lib/http.ts` 的响应契约对齐）：
 *  - 错误响应统一为 `{ error: string, blocked?: string[] }` + 语义化 HTTP 状态码；
 *  - `requestJson` / `apiGet` / `postJson` … 失败时抛 `ApiError`（含 status）；
 *  - 需要自行分支处理状态码的流程（如发布审核 422）用 `requestSafe`，
 *    以 `{ ok: false, status, error }` 判别联合返回，绝不 throw。
 *
 * 组件代码禁止直接调用 `fetch` —— 读数据用 TanStack Query
 * （`apiQueryOptions` + `useQuery`，见 src/lib/query/），提交用这里的
 * post/put/patch/delete 系列；客户端 UI 状态用 Zustand（src/lib/store/）。
 */

export interface ApiErrorBody {
  error?: string;
  /** 内容审核命中词（POST /api/posts 422 响应附带） */
  blocked?: string[];
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error || `请求失败 (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** 401/403 — 引导登录或静默降级的判断依据 */
export function isAuthError(err: unknown): boolean {
  return isApiError(err) && (err.status === 401 || err.status === 403);
}

async function parseBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null; // 204 / 空响应体
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await parseBody(res);
  if (!res.ok) {
    throw new ApiError(res.status, (body ?? {}) as ApiErrorBody);
  }
  return body as T;
}

export function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  return request<T>(url, init);
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function putJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function patchJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/** DELETE 通常无请求体；需要 body 的场景直接用 requestJson + init。 */
export function deleteJson<T = void>(url: string, body?: unknown): Promise<T> {
  return request<T>(
    url,
    body === undefined
      ? { method: "DELETE" }
      : { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

/**
 * 判别联合版请求 — 永不抛错，把 HTTP 状态与错误体交给调用方分支。
 * 适用于「失败是正常分支」的流程：发布审核（422 blocked）、登录（401/2FA）等。
 */
export type SafeResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string; blocked?: string[] };

export async function requestSafe<T>(url: string, init?: RequestInit): Promise<SafeResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = await parseBody(res);
    if (res.ok) return { ok: true, data: body as T };
    const d = (body ?? {}) as ApiErrorBody;
    return { ok: false, status: res.status, error: d.error, blocked: d.blocked };
  } catch {
    // 网络层失败（断网 / abort）— 没有状态码，归一为 0
    return { ok: false, status: 0 };
  }
}

export function postJsonSafe<T>(url: string, body: unknown): Promise<SafeResult<T>> {
  return requestSafe<T>(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/* ------------------------------ 媒体路径工具 ------------------------------ */

/** Extract the storage path from a media upload response url. */
export function mediaPathFromUrl(url: string): string {
  return url.replace(/^\/api\/media\/file\//, "");
}

export function mediaUrl(path: string): string {
  if (path.startsWith("/api/media/file/") || path.startsWith("http")) return path;
  return `/api/media/file/${path}`;
}

/* --------------------------- Composer 草稿存储键 --------------------------- */
/**
 * localStorage keys for the composer's per-mode autosave. The drawer and the
 * /write article editor share the article key, so work started in one surface
 * seamlessly carries into the other.
 */
export const COMPOSER_DRAFT_PREFIX = "composer.draft.v1";
export const SHORT_DRAFT_KEY = `${COMPOSER_DRAFT_PREFIX}:short`;
export const ARTICLE_DRAFT_KEY = `${COMPOSER_DRAFT_PREFIX}:article`;
