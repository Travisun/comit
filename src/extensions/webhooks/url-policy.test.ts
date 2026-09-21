// 被测模块：src/extensions/webhooks/url-policy.ts —— webhook 端点注册层的 URL 准入
// （协议/凭据/IP 字面量变体/内网主机/长度/归一化/去重键）。纯函数，零网络。
import { describe, expect, it, vi } from "vitest";
import {
  assertWebhookUrl,
  isAcceptedWebhookUrl,
  normalizeWebhookUrl,
  validateWebhookUrl,
  webhookUrlDedupKey,
  WEBHOOK_URL_MAX_LENGTH,
} from "@/extensions/webhooks/url-policy";
import { webhookUrlSchema } from "@/app/api/me/_shared";

// 路由 schema 所在模块顶层 import 了 @/db（本套用例不触库）—— 统一 stub 掉，
// 保证测试进程零 DB 依赖（风格同 src/lib/storage/storage.test.ts）
vi.mock("@/db", () => ({ db: {} }));

const https = (u: unknown) => validateWebhookUrl(u, { allowHttp: false });

describe("协议准入", () => {
  it("放行规范 https 端点并回归一化 href", () => {
    expect(https("https://example.com/hooks/blog")).toBe("https://example.com/hooks/blog");
  });

  it("默认拒绝明文 http（签名头与 payload 不得裸奔在链路上）", () => {
    expect(https("http://example.com/hook")).toBeNull();
    expect(() => assertWebhookUrl("http://example.com/hook")).toThrow(/HTTPS/);
  });

  it("显式 allowHttp（本地联调）才放行 http", () => {
    expect(validateWebhookUrl("http://example.com/hook", { allowHttp: true })).toBe("http://example.com/hook");
  });

  it("zod `z.url()` 宽松的 scheme 一律拒（httpx/javascript/ftp/data 全部不过）", () => {
    for (const u of [
      "httpx://example.com/hook", // 旧 .startsWith("http") 会放过它
      "javascript:alert(1)",
      "ftp://example.com/x",
      "data:application/json,{}",
      "file:///etc/passwd",
      "//example.com/hook",
    ]) {
      expect(https(u), `${u} 应被拒绝`).toBeNull();
    }
  });
});

describe("凭据与端口", () => {
  it("拒绝内嵌 user:pass 凭据（日志泄漏 + 主机混淆面）", () => {
    expect(https("https://user:pass@example.com/hook")).toBeNull();
    expect(https("https://user@example.com/hook")).toBeNull();
  });

  it("拒绝 :0 端口，保留显式合法端口", () => {
    expect(https("https://example.com:0/hook")).toBeNull();
    expect(https("https://example.com:8443/hook")).toBe("https://example.com:8443/hook");
  });
});

describe("主机黑名单（注册层第一道）", () => {
  it("拒绝 localhost / *.internal / 点分 IP 字面量", () => {
    for (const u of [
      "https://localhost/hook",
      "https://api.localhost/hook",
      "https://db.internal/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.1:3000/hook",
      "https://[::1]/hook",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      expect(https(u), `${u} 应被拒绝`).toBeNull();
    }
  });

  it("拒绝十进制/八进制/十六进制 IP 变体（getaddrinfo 会还原成内网）", () => {
    for (const u of [
      "https://2130706433/hook", // = 127.0.0.1
      "https://017700000001/hook", // 八进制整体
      "https://0x7f.0.0.1/hook",
      "https://0177.0.0.1/hook",
      "https://127.1/hook", // 两段简写
    ]) {
      expect(https(u), `${u} 应被拒绝`).toBeNull();
    }
  });

  it("十六进制样式但确为域名的主机不误伤", () => {
    expect(https("https://deadbeef.example.com/hook")).toBe("https://deadbeef.example.com/hook");
    expect(https("https://abcdef0123.io/hook")).toBe("https://abcdef0123.io/hook");
  });

  it("拒绝 host 前后缀伪装（localhost.evil.com 属合法外网域名，不误伤）", () => {
    expect(https("https://localhost.evil.example/hook")).toBe("https://localhost.evil.example/hook");
  });
});

describe("形状与归一化", () => {
  it("拒绝非字符串 / 空串 / 纯空白 / 非法 URL", () => {
    for (const u of [undefined, null, 42, {}, "", "   ", "not a url", "https://", "https://%zz"]) {
      expect(https(u), String(u)).toBeNull();
    }
  });

  it("拒绝含空白/换行/控制符的 URL（解析器分歧面）", () => {
    expect(https("https://example.com/hook\nX-Evil: 1")).toBeNull();
    expect(https("https://exa mple.com/hook")).toBeNull();
    expect(https(" https://example.com/hook ")).toBe("https://example.com/hook"); // 仅首尾空白是裁剪
  });

  it("长度上限", () => {
    const okUrl = `https://example.com/${"a".repeat(100)}`;
    expect(https(okUrl)).not.toBeNull();
    expect(https(`https://example.com/${"a".repeat(WEBHOOK_URL_MAX_LENGTH)}`)).toBeNull();
  });

  it("归一化：默认端口/根路径/大小写主机收敛为同一形态，并保证幂等", () => {
    expect(https("https://EXAMPLE.com:443/hook")).toBe("https://example.com/hook");
    expect(https("https://example.com")).toBe("https://example.com/");
    const once = https("https://example.com:443/hook?a=1#frag")!;
    expect(normalizeWebhookUrl(once)!.href).toBe(once); // 落库值再过一次校验仍成立
    expect(isAcceptedWebhookUrl(once)).toBe(true);
  });
});

describe("重复注册去重键", () => {
  it("大小写 / 默认端口 / 根路径属同一端点", () => {
    expect(webhookUrlDedupKey("https://EXAMPLE.com:443/hook")).toBe(webhookUrlDedupKey("https://example.com/hook"));
    expect(webhookUrlDedupKey("https://example.com")).toBe(webhookUrlDedupKey("https://example.com/"));
  });

  it("路径或查询不同即不同端点；协议/端口不同亦不同", () => {
    expect(webhookUrlDedupKey("https://example.com/a")).not.toBe(webhookUrlDedupKey("https://example.com/b"));
    expect(webhookUrlDedupKey("https://example.com/a")).not.toBe(webhookUrlDedupKey("https://example.com:8443/a"));
    // 非 https（联调放行的 http）与 https 不视为同一端点
    expect(webhookUrlDedupKey("http://example.com/a")).not.toBe(webhookUrlDedupKey("https://example.com/a"));
  });
});

describe("isAcceptedWebhookUrl 与 validateWebhookUrl 一致", () => {
  it("同一个输入两种入口判定结果同步", () => {
    for (const u of ["https://example.com/hook", "http://example.com/hook", "https://2130706433/hook"]) {
      expect(isAcceptedWebhookUrl(u, { allowHttp: false })).toBe(validateWebhookUrl(u, { allowHttp: false }) !== null);
    }
  });
});

describe("路由 schema 接线（POST 创建 / PATCH 改址共用）", () => {
  it("合法 https 端点通过，并写入归一化后的 href", () => {
    const res = webhookUrlSchema.safeParse("https://EXAMPLE.com:443/hooks/blog");
    expect(res.success).toBe(true);
    expect((res as { data: string }).data).toBe("https://example.com/hooks/blog");
  });

  it("内网/凭据/明文 http/IP 变体在创建与改址处同样被拒（错误文案面向用户）", () => {
    for (const u of ["http://example.com/hook", "https://user:pw@example.com/h", "https://169.254.169.254/", "https://2130706433/"]) {
      const res = webhookUrlSchema.safeParse(u);
      expect(res.success, `${u} 应被拒`).toBe(false);
    }
    const res = webhookUrlSchema.safeParse("http://example.com/hook");
    expect((res as { error: { issues: { message: string }[] } }).error.issues[0].message).toMatch(/HTTPS/);
  });

  it("非字符串（undefined/对象/数字）不抛异常，只判失败", () => {
    for (const u of [undefined, null, {}, 1, []]) {
      expect(webhookUrlSchema.safeParse(u).success).toBe(false);
    }
  });
});
