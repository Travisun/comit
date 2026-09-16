// 被测模块：src/core/http-client.ts —— SSRF 防护纯函数：isBlockedAddress（IPv4/IPv6 网段判定，含内嵌 IPv4 还原）
// 与 isForbiddenHostLiteral（主机字面量快速检查）。纯函数，无网络请求。
import { describe, expect, it } from "vitest";
import { isBlockedAddress, isForbiddenHostLiteral } from "@/core/http-client";

describe("isBlockedAddress · IPv4 私网/保留段", () => {
  it("0.0.0.0/8、10/8、127/8、CGNAT 100.64/10 均拦截", () => {
    for (const ip of ["0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "127.0.0.1", "127.255.255.254", "100.64.0.1", "100.127.255.254"]) {
      expect(isBlockedAddress(ip), `${ip} 应被拦截`).toBe(true);
    }
  });

  it("169.254/16 link-local（含云 metadata 169.254.169.254）拦截", () => {
    for (const ip of ["169.254.0.1", "169.254.169.254"]) {
      expect(isBlockedAddress(ip), `${ip} 应被拦截`).toBe(true);
    }
  });

  it("172.16/12 与 192.168/16 私网拦截", () => {
    for (const ip of ["172.16.0.1", "172.31.255.255", "192.168.0.0", "192.168.255.255"]) {
      expect(isBlockedAddress(ip), `${ip} 应被拦截`).toBe(true);
    }
  });

  it("IETF/TEST-NET/6to4/基准测试保留段与组播拦截", () => {
    for (const ip of [
      "192.0.0.1", // IETF 协议分配
      "192.0.2.1", // TEST-NET-1
      "192.88.99.1", // 6to4 relay anycast（已废弃）
      "198.18.0.1", // 基准测试 198.18/15
      "198.19.255.255",
      "198.51.100.7", // TEST-NET-2
      "203.0.113.9", // TEST-NET-3
      "224.0.0.1", // 组播 224/4
      "240.0.0.1", // 保留 240/4
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), `${ip} 应被拦截`).toBe(true);
    }
  });

  it("边界外一角的公网地址不误伤", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "100.63.255.255", // CGNAT 下界外
      "100.128.0.1", // CGNAT 上界外
      "172.15.255.255", // 172.16/12 下界外
      "172.32.0.1", // 172.16/12 上界外
      "192.167.255.255", // 192.168/16 下界外
      "192.169.0.1", // 192.168/16 上界外
      "192.1.2.3", // 非 192.0/192.88 特殊 /24
      "198.20.0.1", // 198.18/15 外
      "198.51.101.1", // TEST-NET-2 外
      "203.0.112.1", // TEST-NET-3 外
      "203.0.114.1", // TEST-NET-3 外
      "223.255.255.1", // 组播前最后一个可用段
    ]) {
      expect(isBlockedAddress(ip), `${ip} 不应被拦截`).toBe(false);
    }
  });

  it("畸形 IPv4 视为被拦（fail closed）", () => {
    for (const ip of ["999.1.1.1", "1.2.3", "1.2.3.4.5", "abc", "-1.2.3.4"]) {
      expect(isBlockedAddress(ip), `畸形地址 ${ip} 应 fail closed`).toBe(true);
    }
  });
});

describe("isBlockedAddress · IPv6 特殊段", () => {
  it("unspecified / loopback / unique-local / link-local / site-local / 组播拦截", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "fec0::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), `${ip} 应被拦截`).toBe(true);
    }
  });

  it("大写形式归一后同样拦截", () => {
    expect(isBlockedAddress("FE80::1")).toBe(true);
    expect(isBlockedAddress("FD00::5")).toBe(true);
  });

  it("IPv4-mapped（::ffff:x）点分与十六进制尾段均还原拦截", () => {
    for (const ip of ["::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254"]) {
      expect(isBlockedAddress(ip), `${ip}（内嵌 IPv4）应被拦截`).toBe(true);
    }
  });

  it("IPv4-compatible（::x）还原拦截：::7f00:1 → 127.0.0.1", () => {
    for (const ip of ["::7f00:1", "::a00:1", "::a9fe:a9fe"]) {
      expect(isBlockedAddress(ip), `${ip}（v4-compatible）应被拦截`).toBe(true);
    }
  });

  it("NAT64（64:ff9b::x）还原拦截：::a00:1 → 10.0.0.1", () => {
    for (const ip of ["64:ff9b::a00:1", "64:ff9b::7f00:1", "64:ff9b::169.254.169.254"]) {
      expect(isBlockedAddress(ip), `${ip}（NAT64）应被拦截`).toBe(true);
    }
  });

  it("公网 IPv6 不误伤（含内嵌公网 IPv4 的 mapped/NAT64）", () => {
    for (const ip of [
      "2606:4700::1111", // Cloudflare DNS
      "2001:4860:4860::8888", // Google DNS
      "2620:fe::fe", // Quad9
      "64:ff9b::808:808", // NAT64 → 8.8.8.8（公网）
      "::ffff:808:808", // mapped → 8.8.8.8（公网）
    ]) {
      expect(isBlockedAddress(ip), `${ip} 不应被拦截`).toBe(false);
    }
  });
});

describe("isForbiddenHostLiteral · 主机字面量快速检查", () => {
  it("localhost/.localhost/.local/.internal 域名拦截（大小写不敏感）", () => {
    for (const host of ["localhost", "LOCALHOST", "api.localhost", "box.local", "MYBOX.LOCAL", "svc.internal", ""] ) {
      expect(isForbiddenHostLiteral(host), `${JSON.stringify(host)} 应被拦截`).toBe(true);
    }
  });

  it("私网/保留 IPv4 与被拦 IPv6 字面量拦截（含方括号形式）", () => {
    for (const host of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "203.0.113.9", "[::1]", "::1", "[fe80::1]"]) {
      expect(isForbiddenHostLiteral(host), `${host} 应被拦截`).toBe(true);
    }
  });

  it("公网 IPv4 / IPv6 / 普通域名不误伤", () => {
    for (const host of ["example.com", "8.8.8.8", "2606:4700::1111", "[2606:4700::1111]", "sub.example.co.uk"]) {
      expect(isForbiddenHostLiteral(host), `${host} 不应被拦截`).toBe(false);
    }
  });

  it("内嵌 IPv4 的 v6 字面量经 isBlockedAddress 同源判定", () => {
    expect(isForbiddenHostLiteral("[::ffff:10.0.0.1]")).toBe(true); // mapped 私网
    expect(isForbiddenHostLiteral("[::ffff:808:808]")).toBe(false); // mapped 8.8.8.8 公网
  });

  it("伪装后缀域名不在此层拦截（权威判定在投递时 DNS 兜底）", () => {
    expect(isForbiddenHostLiteral("localhost.evil.com")).toBe(false);
    expect(isForbiddenHostLiteral("local.st")).toBe(false);
  });
});
