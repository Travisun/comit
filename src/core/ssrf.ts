import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF 网段判定与 DNS 解析原语（与出站客户端 core/http-client 分离）。
 *
 * 分层原因：http-client 的「校验 → IP pin → 直连」管线只经由这两个导出的
 * 窄接口（lookupAddresses / isBlockedAddress）触达 DNS 与网段判定，
 * 单测即可注入可控解析结果验证 pinning 语义，而网段判定本身作为
 * 纯函数独立覆盖（见 http-client.test.ts 经 re-export 的既有用例）。
 */

export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || // 0.0.0.0/8 "this network"（含 0.0.0.0）
    a === 10 || // 10.0.0.0/8 私网
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT/运营商内部
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local（169.254.169.254 云 metadata）
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私网
    (a === 192 && b === 168) || // 192.168.0.0/16 私网
    // 原 /16 全拦过宽，精确到两个特殊 /24（安全方向宁可过拦的其余段已放行）：
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24 IETF 协议分配 + 192.0.2.0/24 TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 relay anycast（RFC 7526 已废弃）
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 基准测试保留
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 TEST-NET-3
    a >= 224 // 组播/保留（224/4、240/4、255.255.255.255）
  );
}

export function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  return (
    addr === "::" || // unspecified
    addr === "::1" || // loopback
    /^f[cd]/.test(addr) || // fc00::/7 unique local
    /^fe[89ab]/.test(addr) || // fe80::/10 link-local
    /^fe[cdef]/.test(addr) || // fec0::/12 已废弃的 site-local（历史私网段，防御性拦截）
    /^ff/.test(addr) // ff00::/8 multicast
  );
}

/**
 * 将 IPv6 地址展开为 8 个 hextet（0-65535）；支持 :: 压缩与点分 IPv4 尾段
 * （如 ::ffff:1.2.3.4 先折算成两个 hextet）。非法/无法解析返回 null。
 */
function expandIpv6Hextets(addr: string): number[] | null {
  let s = addr;
  // 点分 IPv4 尾段 → 两个 hextet（十六进制），统一后续解析
  const v4Tail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const o = v4Tail[2].split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = `${v4Tail[1]}${(((o[0] << 8) | o[1]) >>> 0).toString(16)}:${(((o[2] << 8) | o[3]) >>> 0).toString(16)}`;
  }
  const sections = s.split("::");
  if (sections.length > 2) return null; // 至多一个 ::
  const head = sections[0] ? sections[0].split(":") : [];
  const tail = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  if (sections.length === 1 && head.length !== 8) return null; // 无压缩必须恰好 8 段
  const hextet = /^[0-9a-f]{1,4}$/;
  if (!head.every((h) => hextet.test(h)) || !tail.every((h) => hextet.test(h))) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<string>(fill).fill("0"), ...tail].map((h) => parseInt(h, 16));
}

/**
 * 内嵌 IPv4 归一化：把最后 32 位为嵌入 IPv4 的 IPv6 还原成点分 IPv4 —
 * 覆盖 ::ffff:x（v4-mapped，点分或十六进制尾段，如 ::ffff:a00:1）、
 * ::x（v4-compatible，如 ::7f00:1）、64:ff9b::x（NAT64，RFC 6052）。
 * 非（或非法）该形式返回 null，交回原 IPv6 判定逻辑。
 */
function unwrapEmbeddedIpv4(addr: string): string | null {
  const hextets = expandIpv6Hextets(addr.toLowerCase());
  if (!hextets) return null;
  const [h0, h1, h2, h3, h4, h5] = hextets;
  const mapped = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff; // ::ffff:0:0/96
  const compatible = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0; // ::/96
  const nat64 = h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0; // 64:ff9b::/96
  if (!mapped && !compatible && !nat64) return null;
  const [hi, lo] = [hextets[6], hextets[7]];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** 判定一个解析出的地址是否落在禁止访问的网段（IPv4/IPv6，含内嵌 IPv4 的各类 v6 形式） */
export function isBlockedAddress(ip: string): boolean {
  // ::ffff:a00:1 / ::7f00:1 / 64:ff9b::a00:1 这类先还原成 IPv4 再判定
  const addr = unwrapEmbeddedIpv4(ip) ?? ip.toLowerCase();
  return addr.includes(":") ? isBlockedIpv6(addr) : isBlockedIpv4(addr);
}

/**
 * 同步版主机字面量检查（不做 DNS；用于创建 webhook 时的快速反馈，
 * 权威校验在投递时 ssrfGuard 的 DNS 解析 + IP pin）。域名一律放行 → 投递时兜底。
 */
export function isForbiddenHostLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  // IPv6 字面量走 isBlockedAddress：与投递时权威判定同源（含内嵌 IPv4 还原）
  if (host.includes(":")) return isBlockedAddress(host);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isBlockedIpv4(host); // IPv4 字面量
  return false;
}

/** 解析结果（仅保留判定所需字段） */
export interface ResolvedAddress {
  address: string;
}

/**
 * DNS A/AAAA 全量解析 — http-client 校验与实际连接共用的唯一解析入口
 * （每跳恰好解析一次；测试经 seam 注入可控结果验证 IP pinning）。
 */
export async function lookupAddresses(host: string): Promise<ResolvedAddress[]> {
  return lookup(host, { all: true });
}

/** 去掉 URL.hostname 对 IPv6 加的方括号；判断字面量 IP 时复用 */
export function bareHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

/** 字面量 IP 时返回其 family（4/6），否则 0（node isIP 直接返回族号） */
export function literalIpFamily(hostname: string): 4 | 6 | 0 {
  const fam = isIP(bareHostname(hostname));
  return fam === 4 || fam === 6 ? fam : 0;
}
