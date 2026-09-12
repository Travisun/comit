"use client";

/** Small fetch/clipboard helpers shared by all settings panels. */

export async function apiRequest<T = Record<string, unknown>>(
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `请求失败 / HTTP ${res.status}`,
    );
  }
  return data as T;
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

/** Upload an image to the media pipeline; returns the stored media path. */
export async function uploadImage(file: File, kind: "avatar" | "cover"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch("/api/media/upload", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "图片上传失败 / Upload failed",
    );
  }
  const media = data.media as Record<string, unknown> | undefined;
  const path =
    (typeof data.path === "string" && data.path) ||
    (media && typeof media.path === "string" && media.path) ||
    (typeof data.url === "string" && data.url.replace(/^\/api\/media\/file\//, "")) ||
    "";
  if (!path) throw new Error("上传响应缺少路径 / Unexpected upload response");
  return path;
}

export function mediaUrl(path: string | null | undefined): string | null {
  return path ? `/api/media/file/${path}` : null;
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
