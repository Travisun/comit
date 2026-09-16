import { promises as fs } from "fs";
import path from "path";
import { notFound } from "@/core/errors";
import { STORAGE_ROOT } from "@/lib/media";
import { withApi } from "@/lib/http";

/**
 * GET /api/media/file/[...path] — stream a stored (WebP) image from
 * STORAGE_ROOT. Public: URLs are unguessable per-user/per-file nanoid paths.
 * Path-traversal proof: the resolved path must stay inside STORAGE_ROOT.
 */
export const runtime = "nodejs";

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

    const root = path.resolve(STORAGE_ROOT);
    const abs = path.resolve(root, ...segments);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw notFound();
    }

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw notFound();
    }
    if (!stat.isFile()) throw notFound();

    const buf = await fs.readFile(abs);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
}
