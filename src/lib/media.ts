import sharp from "sharp";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { media } from "@/db/schema";
import { emit } from "@/core/events";
import { routes } from "@/core/routes";
import {
  deleteObject,
  isStorageUnavailableError,
  mediaKey,
  mediaPublicUrl,
  putObject,
  readObject,
  scheduleMediaCleanup,
  type StorageTag,
} from "@/lib/storage";

/**
 * Media pipeline: every uploaded image is normalized with sharp and stored
 * as WebP ("lossy enough to compress, faithful enough to read"):
 *  - avatar/logo : 512×512 cover crop
 *  - cover/hero  : 1920px wide, 16:7 smart crop
 *  - featured    : 1600px wide
 *  - inline      : max 2000px wide, aspect preserved
 * Transparency is kept (webp alpha).
 * 落盘经 src/lib/storage 抽象：驱动由 STORAGE_DRIVER 决定（local 磁盘或 R2），
 * 每行 media.storage 记录实际驱动；切换驱动不影响存量文件（混存兼容）。
 */
export { STORAGE_ROOT } from "@/lib/storage";

export type MediaKind = "inline" | "avatar" | "cover" | "featured";

const PIPELINE: Record<MediaKind, { width: number; height?: number; fit: "cover" | "inside"; quality: number }> = {
  avatar: { width: 512, height: 512, fit: "cover", quality: 88 },
  cover: { width: 1920, height: 840, fit: "cover", quality: 84 },
  featured: { width: 1600, fit: "inside", quality: 84 },
  inline: { width: 2000, fit: "inside", quality: 82 },
};

export interface SavedMedia {
  id: string;
  path: string;
  width: number;
  height: number;
  size: number;
  filename: string;
  /** 实际落盘驱动（写入 media.storage 列） */
  storage: StorageTag;
  /** 公开桶直连 R2/CDN，否则经应用路由 /api/media/file/<path> */
  url: string;
}

export async function processAndSaveImage(
  input: Buffer,
  userId: string,
  kind: MediaKind,
  originalName = "image",
): Promise<SavedMedia> {
  const spec = PIPELINE[kind];
  // limitInputPixels：上传体积上限（10MB）管不住解压炸弹 —— 一张几 KB 的
  // APNG/PNG 头部可声明 2.6 亿像素，libvips 默认按该上限放行，解码即数百 MB
  // RGBA × 并发数 = 内存打爆。40Mpix（≈8160×4896）已覆盖所有真实照片，
  // 而本管线最终只输出到 1920 宽。
  const img = sharp(input, { failOn: "none", limitInputPixels: 40_000_000 }).rotate(); // respect EXIF
  const meta = await img.metadata();
  let pipeline = img.resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true });
  if (meta.hasAlpha) pipeline = pipeline.webp({ quality: spec.quality, alphaQuality: 90, effort: 3 });
  else pipeline = pipeline.webp({ quality: spec.quality, effort: 3 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  // 对象键统一 posix 分隔符（R2 只认 posix；本地各 OS 均按 posix 相对路径读写）。
  // 旧 Windows 部署留下的反斜杠 DB 路径仍由本地 readFile 容忍，新键不再产生。
  const filename = `${nanoid(12)}.webp`;
  const relPath = mediaKey(userId, filename);
  const storage = await putObject(relPath, data);

  let row: { id: string };
  try {
    const inserted = await db
      .insert(media)
      .values({
        userId,
        path: relPath,
        filename: `${path.parse(originalName).name || "image"}.webp`,
        mime: "image/webp",
        size: info.size,
        width: info.width,
        height: info.height,
        kind,
        storage,
      })
      .returning({ id: media.id });
    row = inserted[0];
  } catch (err) {
    // DB insert 失败 → 补偿删除刚落盘的对象，避免存储孤儿后 rethrow 原错误。
    // R2 对象按月计费（孤儿是持续成本），不再与 local 时代的「占点磁盘」同权重。
    // 补偿失败不掩盖原错误：deleteObject 自身容忍，.catch 兜住入队补偿的边角。
    await deleteObject(relPath, storage).catch(() => {});
    throw err;
  }

  void emit("media:uploaded", { mediaId: row.id, userId });
  return {
    id: row.id,
    path: relPath,
    width: info.width,
    height: info.height,
    size: info.size,
    filename,
    storage,
    url: mediaPublicUrl(relPath, storage) ?? routes.media(relPath),
  };
}

/**
 * 删除媒体文件（按行的驱动分派；两驱动均容忍已删除）。
 * R2 配置不可用（StorageUnavailableError）→ 转投 storage.delete 队列持久重试：
 * 三个删除调用点（/api/me 批量、/api/media、/api/admin/media/[id]）都先删 DB 行，
 * 这里是防 R2 孤儿的最后一道；队列也不可用时 scheduleMediaCleanup 已醒目告警，
 * 本函数仍不抛 —— 与历史「删除失败不阻断主流程」契约一致。
 */
export async function deleteMediaFile(relPath: string, storage: StorageTag = "local"): Promise<void> {
  try {
    await deleteObject(relPath, storage);
  } catch (err) {
    if (isStorageUnavailableError(err)) {
      await scheduleMediaCleanup(relPath, storage);
      return;
    }
    throw err;
  }
}

/** 整块读取媒体内容（导出 zip 用）；不存在时抛错，调用方决定跳过 */
export async function readMediaFile(relPath: string, storage: StorageTag): Promise<Buffer> {
  return readObject(relPath, storage);
}

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/tiff",
  "image/bmp",
  "image/svg+xml",
  "image/heic",
  "image/heif",
]);

export function isSupportedImage(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}
