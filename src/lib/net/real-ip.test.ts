// 被测模块：src/lib/net/real-ip.ts —— 部署形态感知的真实客户端 IP 解析（纯函数，无外部依赖）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, trustProxyMode, UNKNOWN_IP } from "@/lib/net/real-ip";

const req = (headers: Record<string, string>): Request =>
  new Request("https://example.com/api/health", { headers });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trustProxyMode", () => {
  it("未设置 TRUST_PROXY 时默认 nginx", () => {
    vi.stubEnv("TRUST_PROXY", undefined); // stub undefined = 从 env 删除
    expect(trustProxyMode()).toBe("nginx");
  });

  it("大小写不敏感地识别 cloudflare / direct", () => {
    vi.stubEnv("TRUST_PROXY", "CloudFlare");
    expect(trustProxyMode()).toBe("cloudflare");
    vi.stubEnv("TRUST_PROXY", "DIRECT");
    expect(trustProxyMode()).toBe("direct");
  });

  it("非法值回落 nginx（安全默认）", () => {
    vi.stubEnv("TRUST_PROXY", "hero");
    expect(trustProxyMode()).toBe("nginx");
  });
});

describe("启动日志只打一次", () => {
  it("多次调用 clientIp 只输出一条 [real-ip] 日志", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("TRUST_PROXY", "nginx");
    clientIp(req({ "x-real-ip": "203.0.113.1" }));
    clientIp(req({ "x-real-ip": "203.0.113.2" }));
    clientIp(req({ "x-real-ip": "203.0.113.3" }));
    const realIpLogs = spy.mock.calls.filter((args) => String(args[0]).includes("[real-ip]"));
    expect(realIpLogs).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("clientIp · nginx 模式（默认）", () => {
  it("x-real-ip 存在时优先于 XFF", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    const ip = clientIp(
      req({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "8.8.8.8, 10.0.0.1" }),
    );
    expect(ip).toBe("203.0.113.5");
  });

  it("x-real-ip 值带空白时去除首尾空白", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    expect(clientIp(req({ "x-real-ip": "  203.0.113.5 " }))).toBe("203.0.113.5");
  });

  it("x-real-ip 为空字符串时视为缺失，回落 XFF（最右一跳是 nginx 追加的客户端地址）", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    const ip = clientIp(req({ "x-real-ip": "", "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));
    expect(ip).toBe("10.0.0.1");
  });

  it("XFF 单跳 + 默认受信代理数 1：最右跳就是 nginx 追加的客户端地址", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", undefined); // 未设置 → 默认 1
    const ip = clientIp(req({ "x-forwarded-for": "203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("XFF 多跳取最右受信跳（TRUSTED_PROXY_COUNT=1 取最右一跳）", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "1");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.1" }));
    expect(ip).toBe("10.0.0.1");
  });

  it("伪造 XFF 头被忽略：攻击者注入的左跳不会作为客户端 IP", () => {
    // 攻击者发 XFF: 6.6.6.6，nginx 追加真实 IP → "6.6.6.6, 9.9.9.9"；
    // 受信代理数 1 → 取最右 9.9.9.9，伪造的 6.6.6.6 被挤到左侧忽略
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "1");
    const ip = clientIp(req({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }));
    expect(ip).toBe("9.9.9.9");
  });

  it("TRUSTED_PROXY_COUNT=2 时取倒数第二跳（双层代理后客户端在其位）", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "2");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("TRUSTED_PROXY_COUNT 等于跳数：最左跳即客户端", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "3");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.1" }));
    expect(ip).toBe("198.51.100.7");
  });

  it("TRUSTED_PROXY_COUNT 超过跳数：整条链不可信 → unknown", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "4");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.1" }));
    expect(ip).toBe(UNKNOWN_IP);
  });

  it("TRUSTED_PROXY_COUNT=0：XFF 整体不受信 → unknown", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "0");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));
    expect(ip).toBe(UNKNOWN_IP);
  });

  it("TRUSTED_PROXY_COUNT 非数字时回落 1", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "abc");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.1" }));
    expect(ip).toBe("10.0.0.1");
  });

  it("XFF 跳间空白与空跳容忍", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "1");
    const ip = clientIp(req({ "x-forwarded-for": " 198.51.100.7 , , 10.0.0.1 " }));
    expect(ip).toBe("10.0.0.1");
  });

  it("无任何代理头 → unknown（非空字符串契约）", () => {
    vi.stubEnv("TRUST_PROXY", "nginx");
    const ip = clientIp(req({}));
    expect(ip).toBe(UNKNOWN_IP);
  });
});

describe("clientIp · cloudflare 模式", () => {
  it("cf-connecting-ip 优先于 x-real-ip 与 XFF", () => {
    vi.stubEnv("TRUST_PROXY", "cloudflare");
    const ip = clientIp(
      req({
        "cf-connecting-ip": "203.0.113.77",
        "x-real-ip": "198.51.100.1",
        "x-forwarded-for": "8.8.8.8, 10.0.0.1",
      }),
    );
    expect(ip).toBe("203.0.113.77");
  });

  it("cf-connecting-ip 缺失时回退 x-real-ip（CF → Nginx 双层代理）", () => {
    vi.stubEnv("TRUST_PROXY", "cloudflare");
    const ip = clientIp(req({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "8.8.8.8, 10.0.0.1" }));
    expect(ip).toBe("198.51.100.1");
  });

  it("cf 与 x-real-ip 均缺失时走 XFF 最右受信跳逻辑", () => {
    vi.stubEnv("TRUST_PROXY", "cloudflare");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "1");
    const ip = clientIp(req({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));
    expect(ip).toBe("10.0.0.1");
  });

  it("cf-connecting-ip 值带空白时去除首尾空白", () => {
    vi.stubEnv("TRUST_PROXY", "cloudflare");
    expect(clientIp(req({ "cf-connecting-ip": " 203.0.113.77 " }))).toBe("203.0.113.77");
  });
});

describe("clientIp · direct 模式", () => {
  it("任何代理头都不信任，恒返回 unknown", () => {
    vi.stubEnv("TRUST_PROXY", "direct");
    const ip = clientIp(
      req({
        "cf-connecting-ip": "203.0.113.77",
        "x-real-ip": "198.51.100.1",
        "x-forwarded-for": "8.8.8.8, 10.0.0.1",
      }),
    );
    expect(ip).toBe(UNKNOWN_IP);
  });
});
