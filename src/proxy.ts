/**
 * Proxy（原 middleware）— CSP per-request nonce 的唯一注入点。
 *
 * 每个文档/接口请求生成一次性随机 nonce，构造 CSP 头：
 *  1. 写回「请求头」：Next 16 App Router 在 SSR 时从请求的
 *     Content-Security-Policy 头解析 `'nonce-…'`（见 next 源码
 *     get-script-nonce-from-header），自动把同一 nonce 附到它生成的全部
 *     内联脚本（流式渲染占位 / RSC payload / 框架 chunk）上；
 *  2. 写「响应头」：浏览器实际执行的策略；
 *  3. 另附 `x-nonce` 请求头：应用侧自管内联脚本（根 layout 的
 *     next-themes / dev 清理脚本）从这里读取，与 Next 用同一个 nonce。
 *
 * 前提：页面必须动态渲染（构建期预渲染的 HTML 会烙上构建期 nonce，
 * 运行时头里的 nonce 对不上）。本项目全站动态（根 layout 读 headers/
 * cookies，各路由 force-dynamic），满足要求。
 *
 * style-src 维持 'unsafe-inline'（内联样式依赖面广，本次不动）；dev 仅
 * 放宽 'unsafe-eval'（React 错误栈重建/HMR）。详见 src/core/security/csp.ts。
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildCspHeader, generateCspNonce } from "@/core/security/csp";

export function proxy(request: NextRequest) {
  const nonce = generateCspNonce();
  const csp = buildCspHeader(nonce, {
    isDev: process.env.NODE_ENV !== "production",
  });

  // 传给渲染侧（Next 从请求头 CSP 提取 nonce；x-nonce 供应用代码自取）
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // 浏览器实际执行的策略（响应头）
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * 除纯静态资产外的一切请求（页面 + /api，无文档面死角）：
     * CSP 只对「文档」有意义，静态 chunk/css/字体/图片/图标响应无需
     * per-request nonce（旧方案 next.config headers() 给它们也发了同一份
     * 静态 CSP，移除不构成防护回退）。
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|ico|css|js|mjs|map|txt|xml|rss|atom|webmanifest|woff|woff2|ttf|otf|eot|mp4|webm|ogg|mp3)$).*)",
  ],
};
