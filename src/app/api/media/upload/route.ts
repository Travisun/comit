import { z } from "zod";
import { AppError } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { isSupportedImage, processAndSaveImage, type MediaKind } from "@/lib/media";
import { routes } from "@/core/routes";

/**
 * POST /api/media/upload — multipart/form-data
 *   file: File (image ≤ 10MB), kind: inline|avatar|cover|featured (default inline)
 * → 200 { id, path, url, width, height, size, filename, mime }
 */
const MAX_BYTES = 10 * 1024 * 1024;

const kindSchema = z.enum(["inline", "avatar", "cover", "featured"]);

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("需要 multipart/form-data 请求体 / multipart body required", 400, "bad_form");
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("缺少文件 / Missing file field", 400, "missing_file");
    }

    const kindParsed = kindSchema.safeParse(form.get("kind") ?? "inline");
    if (!kindParsed.success) {
      throw new AppError("kind 必须是 inline|avatar|cover|featured", 400, "bad_kind");
    }
    const kind = kindParsed.data as MediaKind;

    if (!isSupportedImage(file.type)) {
      throw new AppError("不支持的图片格式 / Unsupported image type", 400, "bad_mime");
    }
    if (file.size > MAX_BYTES) {
      throw new AppError("图片不能超过 10MB / Image exceeds the 10MB limit", 413, "too_large");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let saved;
    try {
      saved = await processAndSaveImage(buffer, auth.user.id, kind, file.name || "image");
    } catch (err) {
      console.error("[media/upload] process failed:", err);
      throw new AppError("图片处理失败 / Failed to process image", 400, "process_failed");
    }

    return ok({ ...saved, url: routes.media(saved.path), mime: "image/webp" });
  });
}
