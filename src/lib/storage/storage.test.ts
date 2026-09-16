// 被测模块：src/lib/storage —— 驱动选择（fail-safe 回落）、公开直连 URL、posix 键拼装、
// 键形状守卫、删除失败语义（配置不可用抛错 + 队列补偿）、R2 错误脱敏接线。
// 纯判定逻辑测试：vi.mock 掉 server-only（vitest 无 react-server 条件，真实入口会 throw）、
// @aws-sdk/client-s3（S3Client.send 收口到可编程 mock，本套用例绝不触网）与
// @/core/queue（不加载 pg-boss 真实模块）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queue } from "@/core/queue";
import {
  activeStorage,
  asStorageTag,
  deleteObject,
  describeStorageError,
  isMediaObjectKey,
  isStorageUnavailableError,
  mediaKey,
  mediaPublicUrl,
  putObject,
  scheduleMediaCleanup,
  storageStatus,
} from "@/lib/storage";
import { isR2NotFound, scrubR2Message } from "@/lib/storage/r2";

/** S3Client.send 收口 + 客户端实例收集（configSig 重建断言用） */
const s3 = vi.hoisted(() => ({
  send: vi.fn(),
  clients: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor() {
      s3.clients.push(this);
    }
    send(command: unknown) {
      return s3.send(command);
    }
  },
  GetObjectCommand: class {
    constructor(
      public input: Record<string, unknown>,
    ) {}
  },
  PutObjectCommand: class {
    constructor(
      public input: Record<string, unknown>,
    ) {}
  },
  DeleteObjectCommand: class {
    constructor(
      public input: Record<string, unknown>,
    ) {}
  },
}));
vi.mock("@/core/queue", () => ({
  queue: { send: vi.fn() },
}));

const R2_FULL = {
  STORAGE_DRIVER: "r2",
  R2_ACCOUNT_ID: "abc123",
  R2_ACCESS_KEY_ID: "ak",
  R2_SECRET_ACCESS_KEY: "sk",
  R2_BUCKET: "media-bucket",
};

/** 合法媒体键素材：uuid 36 位（含连字符）+ nanoid 12 位 webp */
const UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const NANO = "V1StGXR8_Z5j";
const KEY = `ab/cd/${UUID}/${NANO}.webp`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // 默认拒绝联网（未显式 stub 时任何 SDK 调用都失败，防止测试静默触网）；
  // 清空客户端缓存，让 configSig 重建断言可确定计数
  s3.send.mockReset();
  s3.send.mockRejectedValue(new Error("network disabled in tests"));
  s3.clients.length = 0;
  delete (globalThis as { __mediaR2Client?: unknown }).__mediaR2Client;
});

/** 清空全部 storage 相关 env（stubEnv(undefined) = 从 env 删除） */
function clearStorageEnv(): void {
  vi.stubEnv("STORAGE_DRIVER", undefined);
  vi.stubEnv("R2_ACCOUNT_ID", undefined);
  vi.stubEnv("R2_ACCESS_KEY_ID", undefined);
  vi.stubEnv("R2_SECRET_ACCESS_KEY", undefined);
  vi.stubEnv("R2_BUCKET", undefined);
  vi.stubEnv("R2_PUBLIC_BASE_URL", undefined);
}

/** 以 r2 配置齐全的 env 起步（clear 后逐项 stub，避免继承上一个用例状态） */
function stubR2Full(): void {
  clearStorageEnv();
  for (const [k, v] of Object.entries(R2_FULL)) vi.stubEnv(k, v);
}

describe("驱动选择", () => {
  it("无任何 env 时默认 local（向后兼容），r2Configured=false，不 throw", () => {
    clearStorageEnv();
    expect(activeStorage()).toBe("local");
    expect(storageStatus()).toEqual({ driver: "local", r2Configured: false });
  });

  it("R2 配置齐全且 driver=r2 → r2 生效", () => {
    stubR2Full();
    expect(activeStorage()).toBe("r2");
    expect(storageStatus()).toEqual({ driver: "r2", r2Configured: true });
  });

  it("STORAGE_DRIVER=local 时即使 R2 配置齐全也写 local（显式选择优先）", () => {
    stubR2Full();
    vi.stubEnv("STORAGE_DRIVER", "local");
    expect(activeStorage()).toBe("local");
  });

  it("driver=r2 但缺 R2_BUCKET → 回落 local，console.error 一次且不 throw", () => {
    clearStorageEnv();
    vi.stubEnv("STORAGE_DRIVER", "r2");
    vi.stubEnv("R2_ACCOUNT_ID", "abc123");
    vi.stubEnv("R2_ACCESS_KEY_ID", "ak");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "sk");
    // R2_BUCKET 缺失
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => activeStorage()).not.toThrow();
    expect(activeStorage()).toBe("local");
    expect(activeStorage()).toBe("local"); // 同一 env 状态下解析缓存，不重复告警
    const storageErrors = spy.mock.calls.filter((args) => String(args[0]).includes("[storage]"));
    expect(storageErrors).toHaveLength(1);
    expect(String(storageErrors[0]?.[0])).toContain("R2_BUCKET");
  });

  it("driver=r2 但缺密钥 → 回落 local（fail-safe，站点不挂）", () => {
    clearStorageEnv();
    vi.stubEnv("STORAGE_DRIVER", "r2");
    vi.stubEnv("R2_ACCOUNT_ID", "abc123");
    vi.stubEnv("R2_BUCKET", "media-bucket");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(activeStorage()).toBe("local");
    expect(storageStatus().r2Configured).toBe(false);
  });

  it("STORAGE_DRIVER 大小写敏感：R2/其它非法值一律回落 local", () => {
    clearStorageEnv();
    for (const [k, v] of Object.entries(R2_FULL)) vi.stubEnv(k, v);
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://cdn.example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of ["R2", "s3", "", "local "]) {
      vi.stubEnv("STORAGE_DRIVER", bad);
      expect(activeStorage()).toBe("local");
    }
  });
});

describe("mediaPublicUrl", () => {
  it("local 驱动恒返回 null（即使误配了 publicBaseUrl）", () => {
    clearStorageEnv();
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://cdn.example.com");
    expect(mediaPublicUrl("ab/cd/user/f.webp", "local")).toBeNull();
  });

  it("r2 + publicBaseUrl → 直连 URL 拼接（去尾斜杠）", () => {
    clearStorageEnv();
    for (const [k, v] of Object.entries(R2_FULL)) vi.stubEnv(k, v);
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://cdn.example.com/media/");
    expect(mediaPublicUrl("ab/cd/u123/n.webp", "r2")).toBe("https://cdn.example.com/media/ab/cd/u123/n.webp");
  });

  it("r2 未配 publicBaseUrl（私有桶）→ null，走应用路由转发", () => {
    stubR2Full();
    expect(mediaPublicUrl("ab/cd/u123/n.webp", "r2")).toBeNull();
  });

  it("key 含反斜杠（历史 Windows 行）防御性 posix 化", () => {
    stubR2Full();
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://cdn.example.com");
    expect(mediaPublicUrl("ab\\cd\\u123\\n.webp", "r2")).toBe("https://cdn.example.com/ab/cd/u123/n.webp");
  });
});

describe("mediaKey · posix 键拼装", () => {
  it("按 userId 前 2/4 位分片，统一 / 分隔、绝不产生反斜杠", () => {
    const key = mediaKey("aabbccddeeff", "nanoid.webp");
    expect(key).toBe("aa/bb/aabbccddeeff/nanoid.webp");
    expect(key).not.toContain("\\");
    expect(key.split("/")).toHaveLength(4);
  });

  it("不同 userId 分片互不串目录", () => {
    const a = mediaKey("111122223333", "x.webp");
    const b = mediaKey("222211113333", "x.webp");
    expect(a).toBe("11/11/111122223333/x.webp");
    expect(b).toBe("22/22/222211113333/x.webp");
    expect(a).not.toBe(b);
  });
});

describe("asStorageTag · DB 值安全归一", () => {
  it("仅 r2 归为 r2，local/null/undefined/异体值一律 local", () => {
    expect(asStorageTag("r2")).toBe("r2");
    expect(asStorageTag("local")).toBe("local");
    expect(asStorageTag(null)).toBe("local");
    expect(asStorageTag(undefined)).toBe("local");
    expect(asStorageTag("R2")).toBe("local");
    expect(asStorageTag("s3")).toBe("local");
  });
});

describe("isMediaObjectKey · 键形状守卫（桶专用兜底）", () => {
  it("合法键（分片 + 小写 uuid 36 位 + nanoid 12 位 .webp）→ true", () => {
    expect(isMediaObjectKey(KEY)).toBe(true);
  });

  it("uuid 大写（历史导入）与 nanoid 混合大小写同样匹配 → true", () => {
    expect(isMediaObjectKey(`AB/CD/${UUID.toUpperCase()}/${NANO}.webp`)).toBe(true);
  });

  it("nanoid 长度不对（11/13 位）→ false", () => {
    expect(isMediaObjectKey(`ab/cd/${UUID}/V1StGXR8_Z5.webp`)).toBe(false);
    expect(isMediaObjectKey(`ab/cd/${UUID}/V1StGXR8_Z5jd.webp`)).toBe(false);
  });

  it("非 webp 扩展名 / 无扩展名 → false", () => {
    expect(isMediaObjectKey(`ab/cd/${UUID}/${NANO}.png`)).toBe(false);
    expect(isMediaObjectKey(`ab/cd/${UUID}/${NANO}`)).toBe(false);
  });

  it("路径逃逸形状（.. 段 / 多余 ..）→ false", () => {
    expect(isMediaObjectKey(`ab/../${UUID}/${NANO}.webp`)).toBe(false);
    expect(isMediaObjectKey(`../../${UUID}/${NANO}.webp`)).toBe(false);
    expect(isMediaObjectKey(`ab/cd/${UUID}/../../${NANO}.webp`)).toBe(false);
  });

  it("空段 / 段数不足 → false", () => {
    expect(isMediaObjectKey(`ab//${UUID}/${NANO}.webp`)).toBe(false);
    expect(isMediaObjectKey(`ab/${UUID}/${NANO}.webp`)).toBe(false);
    expect(isMediaObjectKey("")).toBe(false);
  });
});

describe("deleteObject · r2 配置不可用抛错（P1）与容忍边界", () => {
  it("配置不可用 → 抛 StorageUnavailableError（isStorageUnavailableError 可判定），不触 SDK、不入队", async () => {
    clearStorageEnv(); // r2:null（driver 默认 local，无告警噪音）
    const err = await deleteObject(KEY, "r2").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isStorageUnavailableError(err)).toBe(true);
    expect((err as Error).name).toBe("StorageUnavailableError");
    expect(s3.send).not.toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("local 行不受影响：配置不可用时 localDelete 照常容忍", async () => {
    clearStorageEnv();
    await expect(deleteObject(`ab/cd/${UUID}/${NANO}.webp`, "local")).resolves.toBeUndefined();
  });

  it("配置可用 → 直接删除（happy path 不变，不入队），DeleteObjectCommand 键正确", async () => {
    stubR2Full();
    s3.send.mockResolvedValue({});
    await expect(deleteObject(KEY, "r2")).resolves.toBeUndefined();
    expect(s3.send).toHaveBeenCalledTimes(1);
    const cmd = s3.send.mock.calls[0]?.[0] as { input: { Bucket: string; Key: string } };
    expect(cmd.input.Bucket).toBe("media-bucket");
    expect(cmd.input.Key).toBe(KEY);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("R2 网络类失败仍容忍（warn 不抛），与历史语义一致", async () => {
    stubR2Full();
    s3.send.mockRejectedValue(new Error("upstream connect timeout"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deleteObject(KEY, "r2")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("scrub 接线 · R2 错误原地脱敏（P2-2）", () => {
  it("putObject rethrow 的 message 已抹掉桶名/accountId，err.name 保留供 isR2NotFound 判定", async () => {
    stubR2Full();
    const boom = Object.assign(new Error("bucket media-bucket not found for account abc123"), {
      name: "NoSuchBucket",
    });
    s3.send.mockRejectedValue(boom);
    const err = await putObject(KEY, new Uint8Array([1, 2, 3])).then(() => null, (e: unknown) => e);
    expect(err).toBe(boom); // 原地改写：同一实例，堆栈不丢
    const msg = (err as Error).message;
    expect(msg).not.toContain("media-bucket");
    expect(msg).not.toContain("abc123");
    expect(msg).toContain("«bucket»");
    expect(msg).toContain("«account»");
    expect((err as Error).name).toBe("NoSuchBucket");
  });

  it("describeStorageError 第二道防线兜底（含旧错误对象）", () => {
    stubR2Full();
    const summarized = describeStorageError(new Error("x media-bucket y abc123 z"));
    expect(summarized).toContain("«bucket»");
    expect(summarized).toContain("«account»");
    expect(summarized).not.toContain("media-bucket");
    expect(summarized).not.toContain("abc123");
  });
});

describe("r2 驱动纯逻辑（isR2NotFound / scrubR2Message / 客户端重建）", () => {
  it("isR2NotFound：NoSuchKey / NotFound / 404 状态码三分支命中，其它不命中", () => {
    expect(isR2NotFound({ name: "NoSuchKey" })).toBe(true);
    expect(isR2NotFound({ name: "NotFound" })).toBe(true);
    expect(isR2NotFound({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isR2NotFound({ name: "NetworkingError" })).toBe(false);
    expect(isR2NotFound({ $metadata: { httpStatusCode: 500 } })).toBe(false);
    expect(isR2NotFound(null)).toBe(false);
  });

  it("scrubR2Message：桶名/accountId → 占位符，非 Error 输入走 String()", () => {
    const cfg = { accountId: "acc1", bucket: "bkt", accessKeyId: "", secretAccessKey: "", publicBaseUrl: "" };
    expect(scrubR2Message(cfg, new Error("fail acc1 bkt end"))).toBe("fail «account» «bucket» end");
    expect(scrubR2Message(cfg, "plain bkt text")).toBe("plain «bucket» text");
  });

  it("configSig 变化 → S3Client 重建；同配置复用单例", async () => {
    stubR2Full();
    s3.send.mockResolvedValue({});
    await putObject(KEY, new Uint8Array([1]));
    expect(s3.clients).toHaveLength(1);
    vi.stubEnv("R2_ACCESS_KEY_ID", "ak2"); // 签名变化（模拟 dev 热重载换凭据）
    await putObject(KEY, new Uint8Array([2]));
    expect(s3.clients).toHaveLength(2);
    await putObject(KEY, new Uint8Array([3])); // 同配置 → 复用，不再重建
    expect(s3.clients).toHaveLength(2);
    expect(s3.send).toHaveBeenCalledTimes(3);
  });
});

describe("putObject · 对象元数据（P2-6 CacheControl）", () => {
  it("PutObjectCommand 带 immutable CacheControl（与应用路由响应头对等）", async () => {
    stubR2Full();
    s3.send.mockResolvedValue({});
    await putObject(KEY, new Uint8Array([1]));
    const cmd = s3.send.mock.calls[0]?.[0] as {
      input: { Bucket: string; Key: string; ContentType: string; CacheControl: string };
    };
    expect(cmd.input.Bucket).toBe("media-bucket");
    expect(cmd.input.Key).toBe(KEY);
    expect(cmd.input.ContentType).toBe("image/webp");
    expect(cmd.input.CacheControl).toBe("public, max-age=31536000, immutable");
  });
});

describe("scheduleMediaCleanup · storage.delete 入队补偿（P1）", () => {
  it("queue.send 成功（返回 jobId）→ true，载荷为 key+storage", async () => {
    vi.mocked(queue.send).mockResolvedValue("job-1");
    await expect(scheduleMediaCleanup(KEY, "r2")).resolves.toBe(true);
    expect(queue.send).toHaveBeenCalledWith("storage.delete", { key: KEY, storage: "r2" });
  });

  it("queue.send 返回 null（队列不可用）→ false + console.error 醒目告警（含 key）", async () => {
    vi.mocked(queue.send).mockResolvedValue(null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(scheduleMediaCleanup(KEY, "r2")).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain(KEY);
    expect(String(spy.mock.calls[0]?.[0])).toContain("人工清理");
  });

  it("queue.send 抛错（pg-boss 起不来）→ false + console.error，不向调用方传播", async () => {
    vi.mocked(queue.send).mockRejectedValue(new Error("boss down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(scheduleMediaCleanup(KEY, "r2")).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
