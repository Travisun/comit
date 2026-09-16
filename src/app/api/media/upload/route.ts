import { z } from "zod";
import { AppError } from "@/core/errors";
import { ok, withUser } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { isSupportedImage, processAndSaveImage, type MediaKind } from "@/lib/media";
import { routes } from "@/core/routes";
import { runMediaProcessors } from "@/core/capabilities/media";
import { hooks } from "@/core/hooks";

/**
 * POST /api/media/upload — multipart/form-data
 *   file: File (image ≤ 10MB), kind: inline|avatar|cover|featured (default inline)
 * → 200 { id, path, url, width, height, size, filename, mime }
 */
const MAX_BYTES = 10 * 1024 * 1024;
// multipart 编码有 boundary/头部开销，声明长度留 15% 余量再拒，避免误伤合法文件
const MULTIPART_HEADROOM = 1.15;

const kindSchema = z.enum(["inline", "avatar", "cover", "featured"]);

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    // per-user 限流：20 次/分钟（对齐 auth 组的 rateLimit 用法）
    rateLimit(`upload:${auth.user.id}`, 20, 60_000);

    // 解析 formData 前先按 Content-Length 短路，避免超大 body 白白占用内存
    const declaredLength = Number(req.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_BYTES * MULTIPART_HEADROOM
    ) {
      throw new AppError("图片不能超过 10MB / Image exceeds the 10MB limit", 413, "too_large");
    }

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

    // 上传前钩子（扩展可拒绝：配额/风控/类型策略）
    const uploadCtx = {
      userId: auth.user.id,
      kind,
      filename: file.name,
      size: file.size,
      mime: file.type,
      rejection: null as string | null,
      reject(reason: string) {
        uploadCtx.rejection = reason;
      },
    };
    await hooks.callHook("media:uploading", uploadCtx);
    if (uploadCtx.rejection) {
      throw new AppError(uploadCtx.rejection, 422, "extension_rejected");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let saved;
    try {
      saved = await processAndSaveImage(buffer, auth.user.id, kind, file.name || "image");
    } catch (err) {
      console.error("[media/upload] process failed:", err);
      // sharp's prebuilt libvips cannot decode Apple's HEVC-encoded HEIC —
      // fail with an actionable message instead of a generic processing error
      if (/^image\/hei/.test(file.type)) {
        throw new AppError(
          "暂不支持 iPhone 的 HEIC 格式，请转存为 JPG/PNG 后再上传（iPhone 可在「设置 → 相机 → 格式」选兼容性最佳）",
          400,
          "heic_unsupported",
        );
      }
      throw new AppError("图片处理失败 / Failed to process image", 400, "process_failed");
    }

    // 扩展后处理管道（水印/扫描/alt 生成…）：失败只记日志，不阻断上传
    await runMediaProcessors({
      path: saved.path,
      url: routes.media(saved.path),
      mime: "image/webp",
      size: saved.size,
      userId: auth.user.id,
      kind,
    });

    return ok({ ...saved, url: routes.media(saved.path), mime: "image/webp" });
  });
}
