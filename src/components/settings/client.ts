"use client";

import { deleteJson, patchJson, postJson, putJson, requestJson } from "@/lib/client/api";
import { uploadImage as uploadMedia } from "@/components/editor/upload";
import { routes } from "@/core/routes";

/** Settings 域客户端 — 各设置面板共享的 API/剪贴板助手。
 * 传输统一委托 lib/client/api，本文件只保留域语义入口。 */

export async function apiRequest<T = Record<string, unknown>>(
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  switch (method) {
    case "GET":
      return requestJson<T>(url);
    case "POST":
      return postJson<T>(url, body);
    case "PUT":
      return putJson<T>(url, body);
    case "PATCH":
      return patchJson<T>(url, body);
    case "DELETE":
      return deleteJson<T>(url, body);
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // legacy fallback for non-secure contexts
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand("copy");
      document.body.removeChild(ta);
      return done;
    } catch {
      return false;
    }
  }
}

/**
 * Upload an image (avatar/cover) through the shared media client — it
 * pre-shrinks and re-encodes in the browser (WebP, JPEG fallback) and
 * reports upload progress — then return the stored media path.
 */
export async function uploadImage(
  file: File,
  kind: "avatar" | "cover",
  onProgress?: (pct: number) => void,
): Promise<string> {
  const res = await uploadMedia(file, kind, onProgress);
  return res.path;
}

export function mediaUrl(path: string | null | undefined): string | null {
  return path ? routes.media(path) : null; // 统一走 routes（原手拼与 routes.media 重复实现）
}

export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua)
      ? "macOS"
      : /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/i.test(ua)
          ? "iOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Safari\//i.test(ua)
        ? "Safari"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : "Browser";
  return `${browser} · ${os}`;
}
