import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import slugify from "slugify";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Strip markdown syntax down to plain text (for excerpts / search / LLM). */
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeExcerpt(md: string, len = 160): string {
  const plain = markdownToPlain(md);
  return plain.length > len ? `${plain.slice(0, len)}…` : plain;
}

export function readingMinutes(md: string): number {
  const cjk = (md.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = md
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220 + cjk / 380));
}

export function slugifyTitle(title: string): string {
  const s = slugify(title, { lower: true, strict: true, trim: true }).slice(0, 80);
  return s || `post-${Date.now().toString(36)}`;
}

export function randomSuffix(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function timeAgo(date: Date | string, locale: "zh" | "en"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const day = Math.floor(h / 24);
  if (locale === "zh") {
    if (s < 60) return "刚刚";
    if (m < 60) return `${m} 分钟前`;
    if (h < 24) return `${h} 小时前`;
    if (day < 30) return `${day} 天前`;
    return d.toLocaleDateString("zh-CN");
  }
  if (s < 60) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString("en-US");
}

export function formatDate(date: Date | string, locale: "zh" | "en"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function truncate(str: string, len: number): string {
  return str.length > len ? `${str.slice(0, len)}…` : str;
}
