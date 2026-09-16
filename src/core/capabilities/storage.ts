import { readFile, unlink, writeFile } from "node:fs/promises";
import fsPromised from "node:fs/promises";
import nodePath from "node:path";

/**
 * Storage 抽象（Laravel Storage / Flysystem 对应物）— 扩展与核心统一经
 * `storage.disk(name)` 读写文件，底层适配器可替换（默认 local，可扩展
 * S3/R2/OSS 等远端适配器）。
 *
 * 适配器契约（8 个方法）：put / read / delete / exists / url / size / list。
 * url() 返回可直接访问的地址（local ⇒ /api/media/file/...）。
 */

export interface StorageAdapter {
  /** 写入文件（data 为字节或字符串） */
  put(path: string, data: Uint8Array | string): Promise<void>;
  read(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  /** 列出前缀下的相对路径（本地实现用递归） */
  list(prefix?: string): Promise<string[]>;
  /** 公开访问地址 */
  url(path: string): string;
}

/* ------------------------------ 本地适配器 ------------------------------- */

const LOCAL_ROOT = nodePath.join(process.cwd(), "storage", "media");

function resolveSafe(relPath: string): string {
  const abs = nodePath.resolve(LOCAL_ROOT, relPath);
  if (!abs.startsWith(LOCAL_ROOT)) throw new Error(`非法存储路径 / Illegal storage path: ${relPath}`);
  return abs;
}

export const localAdapter: StorageAdapter = {
  async put(path, data) {
    const abs = resolveSafe(path);
    await fsPromised.mkdir(nodePath.dirname(abs), { recursive: true });
    await writeFile(abs, data);
  },
  async read(path) {
    return readFile(resolveSafe(path));
  },
  async delete(path) {
    await unlink(resolveSafe(path)).catch(() => undefined);
  },
  async exists(path) {
    return readFile(resolveSafe(path)).then(
      () => true,
      () => false,
    );
  },
  async size(path) {
    return (await readFile(resolveSafe(path))).byteLength;
  },
  async list() {
    // 本地适配器暂不提供递归列举（未有线状遍历需求）；远端适配器可实现
    return [];
  },
  url(path) {
    return `/api/media/file/${path}`;
  },
};

/* ------------------------------- 注册表 --------------------------------- */

const g = globalThis as unknown as {
  __mbStorageAdapters?: Map<string, StorageAdapter>;
  __mbStorageDefault?: string;
};
const adapters: Map<string, StorageAdapter> = (g.__mbStorageAdapters ??= new Map());
adapters.set("local", localAdapter);

export function registerStorageAdapter(name: string, adapter: StorageAdapter, isDefault = false): void {
  adapters.set(name, adapter);
  if (isDefault) g.__mbStorageDefault = name;
}

export function storageDisk(name?: string): StorageAdapter {
  const adapter = adapters.get(name ?? g.__mbStorageDefault ?? "local");
  if (!adapter) throw new Error(`未知存储适配器 / Unknown storage adapter: ${name}`);
  return adapter;
}

export const storage = {
  disk: storageDisk,
  registerAdapter: registerStorageAdapter,
  /** 便捷静态方法（默认磁盘） */
  put: (p: string, d: Uint8Array | string) => storageDisk().put(p, d),
  read: (p: string) => storageDisk().read(p),
  delete: (p: string) => storageDisk().delete(p),
  exists: (p: string) => storageDisk().exists(p),
  url: (p: string) => storageDisk().url(p),
};
