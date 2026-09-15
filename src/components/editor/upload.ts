"use client";

import { routes } from "@/core/routes";

export interface UploadResult {
  id: string;
  path: string;
  url: string;
  width: number;
  height: number;
  size: number;
  filename: string;
}

export type UploadKind = "inline" | "avatar" | "cover" | "featured";

/**
 * Max source edge per kind — matches the server sharp pipeline, so the
 * pre-shrunk file is (nearly) final-size before it ever hits the network.
 */
const UPLOAD_MAX_EDGE: Record<UploadKind, number> = {
  avatar: 512,
  cover: 1920,
  featured: 1600,
  inline: 2000,
};

/**
 * Client-side pre-shrink: decode with the browser's own image pipeline (this
 * also transparently handles HEIC on macOS/iOS, which sharp on the server
 * cannot decode), downscale to the pipeline's target size, re-encode as WebP
 * (JPEG fallback when WebP encoding is unsupported or turns out bigger).
 * Cuts a 5–10MB phone original to a few hundred KB. Anything the browser
 * can't decode (or that should stay vector/animated: SVG, GIF) is sent
 * as-is and the server pipeline decides.
 */
async function compressImage(file: File, kind: UploadKind): Promise<File | Blob> {
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
  if (typeof createImageBitmap === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_EDGE[kind] / Math.max(bmp.width, bmp.height));
    // already at target size and under 512KB → ship the original untouched
    if (scale === 1 && file.size <= 512 * 1024) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const toBlob = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    const webp = await toBlob("image/webp");
    if (webp && webp.size < file.size) return webp;
    const jpeg = await toBlob("image/jpeg");
    if (jpeg && jpeg.size < file.size) return jpeg;
    return file;
  } catch {
    // undecodable here (e.g. HEIC on platforms without a native codec) —
    // upload raw and let the server return a precise error if it can't cope
    return file;
  }
}

/**
 * Upload one image via XHR (so callers get upload progress) after client-side
 * compression, and resolve with { id, path, url, ... }. Rejects with the
 * server's error message.
 */
export async function uploadImage(
  file: File,
  kind: UploadKind = "inline",
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const payload = await compressImage(file, kind);
  const same = payload === file;

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(
      "file",
      payload,
      same
        ? file.name
        : `${file.name.replace(/\.[^.]+$/, "") || "image"}${payload.type === "image/jpeg" ? ".jpg" : ".webp"}`,
    );
    form.append("kind", kind);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && typeof data === "object" && "url" in (data as object)) {
        resolve(data as UploadResult);
      } else {
        const msg =
          data && typeof data === "object" && "error" in (data as Record<string, unknown>)
            ? String((data as Record<string, unknown>).error)
            : `Upload failed (${xhr.status})`;
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("网络错误，上传失败 / Network error"));
    xhr.send(form);
  });
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
  return routes.media(path);
}
