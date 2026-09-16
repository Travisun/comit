import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 driver (S3-compatible API).
 *
 * 两种部署形态（Deployment shapes）：
 *  - 公开桶（public bucket）：配置 R2_PUBLIC_BASE_URL（自定义域或 r2.dev 地址），
 *    新上传图片的 url 直连 R2/CDN（mediaPublicUrl），应用路由 /api/media/file
 *    仅服务存量本地文件与未配公开域前的旧 R2 行。
 *  - 私有桶（private bucket）：不配 R2_PUBLIC_BASE_URL，所有 R2 读取经应用路由
 *    GetObject 流式转发（不整块进内存，10MB 上限之外还要扛并发）。
 *
 * 安全约束：AccessKey/Secret/桶名永不入日志 —— index 层对 SDK 错误原地改写
 * message（经 scrub() 抹掉端点里的 accountId 与桶名，保留 name/堆栈）后 rethrow。
 * 桶专用约束：桶必须专用（只放本应用媒体对象）——私有桶形态下整桶可经应用
 * 路由回源公开，file 路由以键形状守卫（storage/index.ts isMediaObjectKey）兜底，
 * 但守卫只认媒体键形状，桶里混入同形状对象的防范仍靠运维纪律。
 */

export interface R2RuntimeConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** "" 表示私有桶（经应用路由转发）；非空为公开基址（无尾斜杠） */
  publicBaseUrl: string;
}

/** dev 热重载下防重复建连；按配置签名缓存，env 变更（测试/多租户）自动重建 */
const g = globalThis as unknown as { __mediaR2Client?: { sig: string; client: S3Client } };

function configSig(cfg: R2RuntimeConfig): string {
  // 签名只用于失效判断，本身不含密钥明文的输出路径（不打印）
  return [cfg.accountId, cfg.accessKeyId, cfg.secretAccessKey, cfg.bucket].join("\u0000");
}

/** 惰性单例 S3Client：endpoint 走 accountId 子域，path-style（bucket 在 path 上，R2 推荐） */
function getR2Client(cfg: R2RuntimeConfig): S3Client {
  const sig = configSig(cfg);
  if (g.__mediaR2Client?.sig === sig) return g.__mediaR2Client.client;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  g.__mediaR2Client = { sig, client };
  return client;
}

/** 抹掉错误信息里的 accountId / 桶名，避免端点细节进日志 */
function scrub(cfg: R2RuntimeConfig, err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (cfg.bucket) msg = msg.replaceAll(cfg.bucket, "«bucket»");
  if (cfg.accountId) msg = msg.replaceAll(cfg.accountId, "«account»");
  return msg;
}
/** 供 index 层做错误 message 原地脱敏（保留 name/堆栈）后统一 rethrow */
export { scrub as scrubR2Message };

export async function r2Put(cfg: R2RuntimeConfig, key: string, data: Uint8Array): Promise<void> {
  const client = getR2Client(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: data,
      ContentType: "image/webp",
      // 与应用路由响应头对等（public, immutable）：公开桶直连 CDN 时缓存行为一致
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function r2Delete(cfg: R2RuntimeConfig, key: string): Promise<void> {
  const client = getR2Client(cfg);
  // R2 对不存在的 key 的 Delete 同样返回成功 —— 与本地驱动「容忍已删除」对齐
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

export async function r2Read(cfg: R2RuntimeConfig, key: string): Promise<Buffer> {
  const client = getR2Client(cfg);
  const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  return Buffer.from(bytes ?? []);
}

/** 流式读取（file 路由专用）：Body 直接转 Web ReadableStream，不整块 buffer 进内存 */
export async function r2Stream(
  cfg: R2RuntimeConfig,
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentLength: number | null }> {
  const client = getR2Client(cfg);
  const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const stream = res.Body?.transformToWebStream() as ReadableStream<Uint8Array> | undefined;
  if (!stream) throw new Error(`R2 GetObject returned empty body: ${key}`);
  return { stream, contentLength: res.ContentLength ?? null };
}

/** R2/S3 404 判定：NoSuchKey（新）/ NotFound（旧式）两种错误名 + 状态码兜底 */
export function isR2NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e) return false;
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}
