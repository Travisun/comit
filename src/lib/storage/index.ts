import { config } from "@/core/config";
import { queue } from "@/core/queue";
import { localDelete, localPut, localRead } from "./local";
import {
  isR2NotFound,
  r2Delete,
  r2Put,
  r2Read,
  r2Stream,
  scrubR2Message,
  type R2RuntimeConfig,
} from "./r2";

/**
 * Storage facade — 媒体附件的驱动抽象。
 *
 * 每行媒体通过 media.storage 记录自己的驱动（varchar local|r2），读/删按行分派：
 * 切换 STORAGE_DRIVER 只影响新写入，存量本地文件永远可读可删（混存兼容）。
 * 本文件不含 SDK 细节：本地见 ./local，R2 见 ./r2。
 * 依赖方向：lib → core（config/queue）；core/queue 只依赖 pg-boss，无环。
 */

export type StorageTag = "local" | "r2";

export { STORAGE_ROOT } from "./local";
export { isR2NotFound };

/**
 * R2 删除补偿任务载荷（JobPayloads 声明合并 —— queue.ts 只读，扩展名在此登记）。
 * 链路：deleteObject 遇「R2 配置不可用」抛 StorageUnavailableError → 调用方经
 * scheduleMediaCleanup 入队 → workers.ts 的 storage.delete 处理器重试删除。
 */
declare module "@/core/queue" {
  interface JobPayloads {
    "storage.delete": { key: string; storage: StorageTag };
  }
}

/**
 * R2 配置不可用（driver 被切走/env 被清空）时 deleteObject 抛出的标记错误。
 * 与其它删除失败（对象已不存在/网络抖动 → 容忍告警）不同：这类失败不重试就是
 * 不可逆孤儿（调用点都先删 DB 行，R2 对象按月计费且公开桶下 CDN 仍可访问），
 * 所以必须抛出让调用方转投 storage.delete 队列做持久重试。
 */
export class StorageUnavailableError extends Error {
  constructor(key: string) {
    super(`[storage] r2 行删除时 R2 配置不可用 / R2 config unavailable: ${key}`);
    this.name = "StorageUnavailableError";
  }
}

/** 判定删除/补偿链路上的「存储配置不可用」错误（name 约定，跨模块实例也成立） */
export function isStorageUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.name === "StorageUnavailableError";
}

interface ResolvedStorage {
  /** 当前生效的写入驱动（r2 配置不完整时回落 local，fail-safe 不挂站点） */
  driver: StorageTag;
  /** R2 必填配置是否齐全（与 driver 无关，health 面板展示用） */
  r2Configured: boolean;
  /** driver=r2 时的运行时配置；回落 local 时为 null */
  r2: R2RuntimeConfig | null;
}

const REQUIRED_R2_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

/** 按 env 签名缓存解析结果：进程内配置不变则只解析/告警一次（≈启动时） */
let cache: { sig: string; resolved: ResolvedStorage } | null = null;

function resolveStorage(): ResolvedStorage {
  const s = config.storage;
  const sig = [
    process.env.STORAGE_DRIVER ?? "",
    process.env.R2_ACCOUNT_ID ?? "",
    process.env.R2_ACCESS_KEY_ID ?? "",
    process.env.R2_SECRET_ACCESS_KEY ?? "",
    process.env.R2_BUCKET ?? "",
    process.env.R2_PUBLIC_BASE_URL ?? "",
  ].join("\u0000");
  if (cache?.sig === sig) return cache.resolved;

  const missing = REQUIRED_R2_KEYS.filter((k) => !(process.env[k] ?? "").trim());
  const r2Configured = missing.length === 0;
  let resolved: ResolvedStorage;
  if (s.driver === "r2" && r2Configured) {
    resolved = {
      driver: "r2",
      r2Configured,
      r2: {
        accountId: s.r2.accountId,
        accessKeyId: s.r2.accessKeyId,
        secretAccessKey: s.r2.secretAccessKey,
        bucket: s.r2.bucket,
        publicBaseUrl: s.r2.publicBaseUrl,
      },
    };
  } else {
    if (s.driver === "r2") {
      // fail-safe：driver=r2 但配置缺失 → 回落 local，站点照常起（只丢一次日志）
      console.error(
        `[storage] STORAGE_DRIVER=r2 但缺少 ${missing.join(", ")}，回落 local 驱动 / ` +
          `incomplete R2 config, falling back to local`,
      );
    }
    resolved = { driver: "local", r2Configured, r2: null };
  }
  cache = { sig, resolved };
  return resolved;
}

/** 当前写入驱动（新上传落在哪里） */
export function activeStorage(): StorageTag {
  return resolveStorage().driver;
}

/** health / ops 探针：{ driver: 生效驱动, r2Configured: R2 必填配置是否齐全 } */
export function storageStatus(): { driver: StorageTag; r2Configured: boolean } {
  const { driver, r2Configured } = resolveStorage();
  return { driver, r2Configured };
}

/** DB 里历史/异体值的安全归一（列虽是 local|r2，防御性兜底为 local） */
export function asStorageTag(value: string | null | undefined): StorageTag {
  return value === "r2" ? "r2" : "local";
}

/**
 * 错误摘要（第二道防线）：抹掉消息里的 accountId / 桶名，密钥永不出现。
 * R2 SDK 错误已在各分支源头经 rethrowScrubbed 原地脱敏，这里兜住旧错误对象、
 * 非 SDK 错误与「脱敏后配置又变了」的边角。
 */
export function describeStorageError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  const { r2 } = resolveStorage();
  let msg = e?.message ?? String(err);
  if (r2?.bucket) msg = msg.replaceAll(r2.bucket, "«bucket»");
  if (r2?.accountId) msg = msg.replaceAll(r2.accountId, "«account»");
  return `${e?.name ?? "Error"}: ${msg}`;
}

/**
 * R2 SDK 错误原地脱敏后 rethrow：只改写 message（accountId/桶名 → 占位符），
 * 保留 err.name（isR2NotFound 判定依赖）与堆栈 —— upload 路由的 console.error、
 * errors.ts 的兜底日志、导出的 String(err) 等下游全部自动脱敏，无需逐点处理。
 */
function rethrowScrubbed(err: unknown, r2: R2RuntimeConfig): never {
  if (err instanceof Error) err.message = scrubR2Message(r2, err);
  throw err;
}

/**
 * 上传对象键拼装 — 统一 posix 分隔符（R2 对象键只认 posix；历史上 Windows 本地
 * 部署用 path.join 落过反斜杠路径，那些旧行仍由 fs readFile 容忍，新键不再产生）。
 */
export function mediaKey(userId: string, filename: string): string {
  return [userId.slice(0, 2), userId.slice(2, 4), userId, filename].join("/");
}

/**
 * 媒体对象键形状守卫：`<shard2>/<shard2>/<uuid 36 位含连字符>/<nanoid 12>.webp`
 * （mediaKey 的产出形状）。uuid 大小写都接受（历史导入可能为大写）。
 *
 * 背景：私有桶形态下整桶可经应用路由 /api/media/file 回源公开 → **桶必须专用**。
 * 该守卫防的是「桶内混入非媒体对象被应用路由当媒体公开」：file 路由 r2 分支
 * 回源前校验，不匹配按 404 静默（与 miss 同处理，不泄露对象是否存在）。
 */
const MEDIA_OBJECT_KEY_RE = /^\w{2}\/\w{2}\/[0-9a-fA-F-]{36}\/[A-Za-z0-9_-]{12}\.webp$/;

export function isMediaObjectKey(key: string): boolean {
  return MEDIA_OBJECT_KEY_RE.test(key);
}

/** 写入当前驱动，返回实际落盘的 tag（写入 DB storage 列） */
export async function putObject(key: string, data: Uint8Array): Promise<StorageTag> {
  const { driver, r2 } = resolveStorage();
  if (driver === "r2" && r2) {
    try {
      await r2Put(r2, key, data);
    } catch (err) {
      rethrowScrubbed(err, r2);
    }
    return "r2";
  }
  await localPut(key, data);
  return "local";
}

/**
 * 按行分派删除。容忍语义（签名不变，仅「配置不可用」从吞改为抛）：
 *  - 对象已不存在 / R2 网络类失败 → 吞掉 + 限频告警（与历史行为一致）；
 *  - R2 配置不可用（driver 切走/env 清空）→ 抛 StorageUnavailableError：
 *    三个删除调用点都是先删 DB 行（级联）后删文件，静默跳过 = 永无重试的孤儿。
 *    调用方 catch 到后应 await scheduleMediaCleanup(key, storage) 转队列持久重试。
 * happy path（R2 配置正常）行为不变：直接删，不入队。
 */
export async function deleteObject(key: string, storage: StorageTag): Promise<void> {
  try {
    if (storage === "r2") {
      const { r2 } = resolveStorage();
      if (!r2) throw new StorageUnavailableError(key);
      try {
        await r2Delete(r2, key);
      } catch (err) {
        rethrowScrubbed(err, r2);
      }
    } else {
      await localDelete(key);
    }
  } catch (err) {
    if (isStorageUnavailableError(err)) throw err; // 不吞：由调用方入队补偿
    console.warn(`[storage] 删除失败（容忍，不阻断）/ delete tolerated: ${key}`, describeStorageError(err));
  }
}

/**
 * R2 行删除的持久重试入口：经 pg-boss 入队 storage.delete（workers.ts 消费，
 * 退避重试；仍不可用时处理器抛错交给 pg-boss）。返回是否成功入队。
 * 队列也不可用（send 返回 null / 抛错）→ 醒目告警提示人工清理并返回 false：
 * 该对象沦为孤儿（R2 按月计费），但不再阻断调用方主流程。
 */
export async function scheduleMediaCleanup(key: string, storage: StorageTag): Promise<boolean> {
  try {
    const jobId = await queue.send("storage.delete", { key, storage });
    if (jobId !== null) return true;
    console.error(
      `[storage] 队列不可用，R2 对象删除补偿入队失败，需人工清理 / queue unavailable, ` +
        `manual cleanup required: storage=${storage} key=${key}`,
    );
    return false;
  } catch (err) {
    console.error(
      `[storage] R2 对象删除补偿入队异常，需人工清理 / cleanup enqueue failed, ` +
        `manual cleanup required: storage=${storage} key=${key}`,
      err,
    );
    return false;
  }
}

/** 按行分派整块读取（导出 zip 用）；不存在时抛错，由调用方决定跳过/404 */
export async function readObject(key: string, storage: StorageTag): Promise<Buffer> {
  if (storage === "r2") {
    const { r2 } = resolveStorage();
    if (!r2) throw new Error(`[storage] r2 行读取时 R2 配置不可用 / R2 config unavailable: ${key}`);
    try {
      return await r2Read(r2, key);
    } catch (err) {
      rethrowScrubbed(err, r2);
    }
  }
  return localRead(key);
}

/**
 * 按行分派流式读取（file 路由 r2 分支专用）：R2 GetObject Body → Web ReadableStream，
 * 不整块进内存。local 退化为整块读取（与现行路由行为一致）。
 */
export async function objectStream(
  key: string,
  storage: StorageTag,
): Promise<{ stream: ReadableStream<Uint8Array>; contentLength: number | null }> {
  if (storage === "r2") {
    const { r2 } = resolveStorage();
    if (!r2) throw new Error(`[storage] r2 行读取时 R2 配置不可用 / R2 config unavailable: ${key}`);
    try {
      return await r2Stream(r2, key);
    } catch (err) {
      rethrowScrubbed(err, r2);
    }
  }
  const buf = await localRead(key);
  return {
    stream: new Blob([new Uint8Array(buf)]).stream(),
    contentLength: buf.byteLength,
  };
}

/**
 * 公开直连 URL：公开桶（r2 + R2_PUBLIC_BASE_URL）返回 `${base}/${key}`；
 * 本地驱动或私有桶（未配公开域）返回 null → 调用方回落 /api/media/file/<key>。
 * key 防御性 posix 化（旧 Windows 行的反斜杠也能拼出合法 URL）。
 */
export function mediaPublicUrl(key: string, storage: StorageTag): string | null {
  if (storage !== "r2") return null;
  const base = resolveStorage().r2?.publicBaseUrl ?? "";
  if (!base) return null;
  return `${base}/${key.replaceAll("\\", "/").replace(/^\/+/, "")}`;
}
