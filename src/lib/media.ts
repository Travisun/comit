import sharp from "sharp";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { media } from "@/db/schema";
import { emit } from "@/core/events";

/**
 * Media pipeline: every uploaded image is normalized with sharp and stored
 * as WebP ("lossy enough to compress, faithful enough to read"):
 *  - avatar/logo : 512×512 cover crop
 *  - cover/hero  : 1920px wide, 16:7 smart crop
 *  - featured    : 1600px wide
 *  - inline      : max 2000px wide, aspect preserved
 * Transparency is kept (webp alpha). Files live under ./storage/media.
 */
export const STORAGE_ROOT = path.join(process.cwd(), "storage", "media");

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
}

export async function processAndSaveImage(
  input: Buffer,
  userId: string,
  kind: MediaKind,
  originalName = "image",
): Promise<SavedMedia> {
  const spec = PIPELINE[kind];
  const img = sharp(input, { failOn: "none" }).rotate(); // respect EXIF
  const meta = await img.metadata();
  let pipeline = img.resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true });
  if (meta.hasAlpha) pipeline = pipeline.webp({ quality: spec.quality, alphaQuality: 90, effort: 3 });
  else pipeline = pipeline.webp({ quality: spec.quality, effort: 3 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  const relDir = path.join(userId.slice(0, 2), userId.slice(2, 4), userId);
  const absDir = path.join(STORAGE_ROOT, relDir);
  await mkdir(absDir, { recursive: true });
  const filename = `${nanoid(12)}.webp`;
  const relPath = path.join(relDir, filename);
  await writeFile(path.join(STORAGE_ROOT, relPath), data);

  const [row] = await db
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
    })
    .returning({ id: media.id });

  void emit("media:uploaded", { mediaId: row.id, userId });
  return { id: row.id, path: relPath, width: info.width, height: info.height, size: info.size, filename };
}

export async function deleteMediaFile(relPath: string): Promise<void> {
  try {
    await unlink(path.join(STORAGE_ROOT, relPath));
  } catch {
    /* already gone */
  }
}

export function mediaAbsPath(relPath: string): string {
  return path.join(STORAGE_ROOT, relPath);
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
