/**
 * 媒体处理管道 — 上传落盘后的后处理钩子（Watermark / 病毒扫描 / alt 文本
 * 生成等）。处理器失败只记日志，不阻断上传本身。
 */
export interface MediaProcessContext {
  /** 存储相对路径（storage/media 下；posix 键，与 media.path 同形） */
  path: string;
  /** 对外 URL（公开桶直连 R2/CDN，否则 /api/media/file/...） */
  url: string;
  mime: string;
  size: number;
  userId: string;
  /** 上传用途：inline / avatar / cover */
  kind: string;
  /**
   * ⚠️ 文件可能不在本地盘：STORAGE_DRIVER=r2 时对象存于 R2。需要读/写文件
   * 内容的处理器必须走 src/lib/storage 抽象（readObject/putObject，按 media
   * 行的 storage 列分派），禁止直接 fs 操作 path。
   */
}

export type MediaProcessor = (ctx: MediaProcessContext) => void | Promise<void>;

const g = globalThis as unknown as {
  __mbMediaProcessors?: Map<string, { order: number; fn: MediaProcessor }>;
};
const processors: Map<string, { order: number; fn: MediaProcessor }> =
  (g.__mbMediaProcessors ??= new Map());

export function registerMediaProcessor(name: string, fn: MediaProcessor, order = 100): void {
  processors.set(name, { order, fn });
}

export async function runMediaProcessors(ctx: MediaProcessContext): Promise<void> {
  const sorted = [...processors.entries()].sort((a, b) => a[1].order - b[1].order);
  for (const [name, { fn }] of sorted) {
    try {
      await fn(ctx);
    } catch (err) {
      console.error(`[media:${name}]`, err);
    }
  }
}
