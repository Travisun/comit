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

/** key 必须解析到 STORAGE_ROOT 之内；含 ../ 等逃逸一律拒绝（导出抓取等上层入口不可信） */
function resolveKey(key: string): string {
  const abs = path.resolve(STORAGE_ROOT, key);
  if (abs !== STORAGE_ROOT && !abs.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("invalid storage key");
  }
  return abs;
}

/** 写入本地磁盘（目录不存在则逐级创建）。key 允许 posix 分隔符，Windows 下落盘为对应分隔。 */
export async function localPut(key: string, data: Uint8Array): Promise<void> {
  const abs = resolveKey(key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

/** 删除本地文件；容忍文件已不存在（与历史 deleteMediaFile 行为一致） */
export async function localDelete(key: string): Promise<void> {
  try {
    await unlink(resolveKey(key));
  } catch {
    /* already gone */
  }
}

/** 读取本地文件；不存在时抛错（由上层决定 404/跳过） */
export async function localRead(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

/** 本地是否存在该文件（存量行探测用） */
export async function localExists(key: string): Promise<boolean> {
  try {
    return (await stat(resolveKey(key))).isFile();
  } catch {
    return false;
  }
}
