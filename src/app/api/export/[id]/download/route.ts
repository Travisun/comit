import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { exportJobs, users } from "@/db/schema";
import { notFound, withUser } from "@/lib/http";
import { parseOrThrow } from "@/app/api/me/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/** must match the export plugin's EXPORT_ROOT (storage/exports) */
const EXPORT_ROOT = path.join(process.cwd(), "storage", "exports");

/** GET /api/export/[id]/download — stream the finished ZIP (owner only). */
export async function GET(req: Request, ctx: Ctx) {
  return withUser(req, async (auth) => {
    const { id } = await ctx.params;
    parseOrThrow(idSchema, id);

    const [job] = await db
      .select({
        status: exportJobs.status,
        filePath: exportJobs.filePath,
        sizeBytes: exportJobs.sizeBytes,
      })
      .from(exportJobs)
      .where(and(eq(exportJobs.id, id), eq(exportJobs.userId, auth.user.id)))
      .limit(1);
    if (!job || job.status !== "done" || !job.filePath) {
      throw notFound("导出不存在或尚未完成 / Export not ready");
    }

    // filePath is stored relative to cwd; resolve + confine to the exports dir
    const abs = path.resolve(process.cwd(), job.filePath);
    if (!abs.startsWith(path.resolve(EXPORT_ROOT) + path.sep)) {
      throw notFound("非法导出路径 / Invalid export path");
    }
    const size = (await stat(abs)).size;

    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);

    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="myblogs-export-${user?.username ?? "user"}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
