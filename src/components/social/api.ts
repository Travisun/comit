/** Tiny fetch helpers shared by the social components. */

/**
 * localStorage keys for the composer's per-mode autosave. The drawer and the
 * /write article editor share the article key, so work started in one surface
 * seamlessly carries into the other.
 */
export const COMPOSER_DRAFT_PREFIX = "composer.draft.v1";
export const SHORT_DRAFT_KEY = `${COMPOSER_DRAFT_PREFIX}:short`;
export const ARTICLE_DRAFT_KEY = `${COMPOSER_DRAFT_PREFIX}:article`;

export interface HttpError extends Error {
  status: number;
}

async function parseError(res: Response): Promise<never> {
  let message = `请求失败 (${res.status})`;
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) message = data.error;
  } catch {
    // ignore malformed error bodies
  }
  const err = new Error(message) as HttpError;
  err.status = res.status;
  throw err;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * postJson that reports non-2xx responses without throwing — for publish
 * flows that need the 422 { error, blocked } moderation payload.
 */
export async function postJsonSafe<T>(
  url: string,
  body: unknown,
): Promise<
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string; blocked?: string[] }
> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty / malformed body
  }
  if (res.ok) return { ok: true, data: data as T };
  const d = (data ?? {}) as { error?: string; blocked?: string[] };
  return { ok: false, status: res.status, error: d.error, blocked: d.blocked };
}

export function isAuthError(err: unknown): boolean {
  const status = (err as HttpError | null)?.status;
  return status === 401 || status === 403;
}

/** Extract the storage path from a media upload response url. */
export function mediaPathFromUrl(url: string): string {
  return url.replace(/^\/api\/media\/file\//, "");
}

export function mediaUrl(path: string): string {
  if (path.startsWith("/api/media/file/") || path.startsWith("http")) return path;
  return `/api/media/file/${path}`;
}
