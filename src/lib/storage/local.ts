import "server-only";
import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * Local disk driver — the original storage backend. Files live under
 * ./storage/media/<xx>/<xx>/<userId>/<nanoid>.webp (existing rows keep working
 * regardless of which driver is active: 按行分派，存量本地文件永远可读可删).
 */

/** 本地媒体根目录（media.ts 原样 re-export，保持既有对外路径不变） */
export const STORAGE_ROOT = path.join(process.cwd(), "storage", "media");

/** 写入本地磁盘（目录不存在则逐级创建）。key 允许 posix 分隔符，Windows 下落盘为对应分隔。 */
export async function localPut(key: string, data: Uint8Array): Promise<void> {
  const abs = path.join(STORAGE_ROOT, key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

/** 删除本地文件；容忍文件已不存在（与历史 deleteMediaFile 行为一致） */
export async function localDelete(key: string): Promise<void> {
  try {
    await unlink(path.join(STORAGE_ROOT, key));
  } catch {
    /* already gone */
  }
}

/** 读取本地文件；不存在时抛错（由上层决定 404/跳过） */
export async function localRead(key: string): Promise<Buffer> {
  return readFile(path.join(STORAGE_ROOT, key));
}

/** 本地是否存在该文件（存量行探测用） */
export async function localExists(key: string): Promise<boolean> {
  try {
    return (await stat(path.join(STORAGE_ROOT, key))).isFile();
  } catch {
    return false;
  }
}
