import { promises as fs } from "fs";
import path from "path";
import { notFound } from "@/core/errors";
import { STORAGE_ROOT } from "@/lib/media";
import {
  activeStorage,
  describeStorageError,
  isMediaObjectKey,
  isR2NotFound,
  objectStream,
} from "@/lib/storage";
import { withApi } from "@/lib/http";

/**
 * GET /api/media/file/[...path] — serve a stored (WebP) image.
 * Public: URLs are unguessable per-user/per-file nanoid paths.
 * Path-traversal proof: the resolved path must stay inside STORAGE_ROOT.
 *
 * 驱动分派（混存兼容）：
 *  - local 驱动 → 行为与历史完全一致（本地盘读取）。
 *  - r2 驱动   → 先探本地（容忍存量 local 行），命中走本地；miss 则从 R2
 *    GetObject 以 Web ReadableStream 流式转发（不整块进内存，10MB 上限之外
 *    还有并发压力）。R2 404 → notFound()；其它异常 → notFound envelope +
 *    限频 console.warn（桶名/账号已脱敏）。
 */
export const runtime = "nodejs";

/** R2 读取异常限频告警：并发风暴（网关抖动）时不刷屏 */
let lastStreamWarnAt = 0;
const STREAM_WARN_INTERVAL_MS = 30_000;

function warnR2StreamError(key: string, err: unknown): void {
  const now = Date.now();
  if (now - lastStreamWarnAt < STREAM_WARN_INTERVAL_MS) return;
  lastStreamWarnAt = now;
  console.warn(`[media/file] R2 读取失败 / R2 read failed: ${key}`, describeStorageError(err));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // withApi：404 统一走 notFound() AppError envelope（维护守卫对 GET 豁免）
  return withApi(req, async () => {
    const { path: segments } = await ctx.params;

    if (!Array.isArray(segments) || segments.length === 0 || segments.some((s) => !s || s === "." || s === "..")) {
      throw notFound();
    }

    const key = segments.join("/"); // posix 对象键（R2 与 DB path 同形）

    // 防穿越守卫约束本地盘读取；R2 对象键是普通字符串、无路径语义
    const root = path.resolve(STORAGE_ROOT);
    const abs = path.resolve(root, ...segments);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw notFound();
    }

    // 本地命中优先（存量 local 行 + r2 驱动下的兼容路径），行为与历史一致
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      stat = null;
    }
    if (stat?.isFile()) {
      const buf = await fs.readFile(abs);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(buf.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (activeStorage() !== "r2") throw notFound();

    // 键形状守卫（桶必须专用，见 r2.ts 部署形态注释）：私有桶整桶可经本路由
    // 回源公开，校验 mediaKey 产出形状，防桶内混入的非媒体对象被应用泄露；
    // 不匹配按 404 静默（与 miss 同处理，不泄露对象是否存在）
    if (!isMediaObjectKey(key)) throw notFound();

    // r2 驱动且本地 miss → R2 流式转发；Content-Type 统一 webp（上传管线已归一）
    try {
      const { stream, contentLength } = await objectStream(key, "r2");
      const headers: Record<string, string> = {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      if (contentLength !== null) headers["Content-Length"] = String(contentLength);
      return new Response(stream, { status: 200, headers });
    } catch (err) {
      // 404（NoSuchKey/NotFound）是正常 miss，静默；其它异常限频告警
      if (!isR2NotFound(err)) warnR2StreamError(key, err);
      throw notFound();
    }
  });
}
