import { describe, expect, it } from "vitest";

import { buildCspHeader, generateCspNonce } from "./csp";

/**
 * CSP nonce 工具契约（src/proxy.ts 每请求调用）：
 *  - nonce 为 base64、每次不同、且匹配 Next 的解析正则
 *    /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/（get-script-nonce-from-header）；
 *  - production 脚本源必须无 unsafe-inline / unsafe-eval；
 *  - dev 仅放宽 unsafe-eval（React 错误栈重建 / HMR），inline 一律走 nonce。
 */
const NEXT_NONCE_REGEX = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

function scriptSrc(header: string): string {
  const dir = header.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
  if (!dir) throw new Error("missing script-src");
  return dir;
}

describe("generateCspNonce", () => {
  it("16 字节 base64（24 字符，含 '==' 填充），两次生成不同", () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("buildCspHeader", () => {
  const nonce = generateCspNonce();
  const prod = buildCspHeader(nonce);
  const dev = buildCspHeader(nonce, { isDev: true });

  it("script-src 含 self/nonce/strict-dynamic，nonce 可被 Next 正则提取", () => {
    const sources = scriptSrc(prod).split(/\s+/).slice(1);
    expect(sources).toContain("'self'");
    expect(sources).toContain("'strict-dynamic'");
    const nonceSource = sources.find((s) => s.startsWith("'nonce-"));
    expect(nonceSource).toMatch(NEXT_NONCE_REGEX);
    expect((nonceSource as string).match(NEXT_NONCE_REGEX)?.[1]).toBe(nonce);
  });

  it("production 的 script-src 无 unsafe-inline / unsafe-eval；全头无 unsafe-eval", () => {
    expect(scriptSrc(prod)).not.toContain("unsafe-inline");
    expect(scriptSrc(prod)).not.toContain("unsafe-eval");
    expect(prod).not.toContain("unsafe-eval");
  });

  it("style-src 维持现状（已知权衡：内联样式依赖面广，暂不收紧）", () => {
    const styleSrc = prod
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("style-src"));
    expect(styleSrc).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("dev 追加 unsafe-eval 但 script-src 仍无 unsafe-inline", () => {
    expect(dev).toContain("'unsafe-eval'");
    expect(scriptSrc(dev)).not.toContain("unsafe-inline");
    expect(scriptSrc(dev)).toContain(`'nonce-${nonce}'`);
  });

  it("保留高价值指令与产品必需的 img/media 放开", () => {
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("frame-ancestors 'self'");
    expect(prod).toContain("img-src * data: blob:");
    expect(prod).toContain("media-src * data: blob:");
    expect(prod).toContain("default-src 'self'");
    expect(prod).toContain("connect-src 'self'");
    expect(prod).toContain("font-src 'self' data:");
  });
});
