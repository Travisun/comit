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
 * Upload one image via XHR (so callers get upload progress) and resolve with
 * { id, path, url, ... }. Rejects with the server's error message.
 */
export function uploadImage(
  file: File,
  kind: UploadKind = "inline",
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
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
