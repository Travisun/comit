import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, requestJson, requestSafe, apiUpload } from "@/lib/client/api";

/**
 * 客户端传输层回归：请求超时归一为 ApiError(0)、200+非 JSON 响应防御、
 * SafeResult 网络失败带诊断信息、上传体积前置校验。
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("request 超时与中断归一", () => {
  it("挂起的请求被 signal 中断时抛 ApiError(0)，而非裸 DOMException", async () => {
    globalThis.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    ) as unknown as typeof fetch;
    // 用 50ms 的外部 signal 驱动 abort（内部 15s 超时与 AbortSignal.any 合并取先触发）
    await expect(
      requestJson("/api/slow", { signal: AbortSignal.timeout(50) }),
    ).rejects.toMatchObject({ name: "ApiError", status: 0 });
  });

  it("超时（TimeoutError）同样归一", async () => {
    globalThis.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("timed out");
            e.name = "TimeoutError";
            reject(e);
          });
        }),
    ) as unknown as typeof fetch;
    await expect(
      requestJson("/api/slow", { signal: AbortSignal.timeout(50) }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("200 + 非 JSON 响应防御", () => {
  it("200 + HTML 错误页 → ApiError 而非 null 强转下游崩溃", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    ) as unknown as typeof fetch;
    const err = await apiGet("/api/posts").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("JSON");
  });

  it("错误响应仍走 ApiError(status) 契约", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "不存在" }), { status: 404 }),
    ) as unknown as typeof fetch;
    const err = await apiGet("/api/posts/nope").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});

describe("requestSafe / apiUpload", () => {
  it("网络失败返回 ok:false + 诊断信息（不再是纯 undefined）", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    const r = await requestSafe("/api/x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(0);
      expect(r.error).toBeTruthy();
    }
  });

  it("超时给出可展示的超时文案", async () => {
    globalThis.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("timed out");
            e.name = "TimeoutError";
            reject(e);
          });
        }),
    ) as unknown as typeof fetch;
    const r = await requestSafe("/api/x", { signal: AbortSignal.timeout(50) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("超时");
  });

  it("apiUpload：超过 10MB 的文件在本地被拒绝（不发请求）", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const fd = new FormData();
    fd.append("file", big);
    const r = await apiUpload("/api/media/upload", fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("apiUpload：正常大小文件照常发出", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const small = new File([new Uint8Array(1024)], "s.png", { type: "image/png" });
    const fd = new FormData();
    fd.append("file", small);
    const r = await apiUpload<{ ok: boolean }>("/api/media/upload", fd);
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
