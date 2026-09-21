/**
 * CSP（Content-Security-Policy）per-request nonce 构造 — 安全头中唯一需要
 * 每请求动态化的部分，由根目录 proxy.ts 在每个请求上调用。
 *
 * 设计（对照旧方案 next.config headers() 里的静态 CSP）：
 *  - script-src 从 `'self' 'unsafe-inline' 'unsafe-eval'` 收紧为
 *    `'self' 'nonce-…' 'strict-dynamic'`（此前 unsafe-inline/unsafe-eval 是给
 *    mermaid（securityLevel: 'strict'，实际不需要 eval）与 KaTeX 兜底加的历史
 *    豁免，现已确认无生产代码依赖，全部移除）。
 *  - 支持 nonce 的浏览器会忽略 script-src 中的 host expression（'self'），
 *    'self' 仅为不支持 nonce 的老浏览器保留 —— 预期行为，可接受。
 *  - 'strict-dynamic'：带 nonce 的脚本（Next 打 nonce 的 chunk，含 vditor
 *    npm 包）通过 createElement("script") 动态注入的同源脚本（/vditor/dist
 *    下的 lute/katex/highlight.js 等，cdn 选项指向 public/vditor）自动继承
 *    信任，无需逐个加 nonce。
 *  - Next 16 的 App Router 在 SSR 时从「请求头」Content-Security-Policy 里
 *    解析 'nonce-…'（get-script-nonce-from-header），自动把 nonce 附到它
 *    生成的全部内联 script / RSC 流占位脚本 / chunk 上 —— 前提是页面为
 *    动态渲染（本项目全站动态，见 proxy 与根 layout 的 headers() 读取）。
 *  - dev 放宽仅 'unsafe-eval'（React 开发期在浏览器重建服务端错误栈需要
 *    eval；Next dev 的 HMR 同理）；'unsafe-inline' 在 dev 也不给，
 *    保证 dev/prod 的 script-src 行为一致性（内联脚本一律走 nonce）。
 *  - style-src 维持 'self' 'unsafe-inline'：内联样式（用户主题 CSS、
 *    vditor 动态 <style>、RSC 注入的 style 标签）依赖面太广，本次不动，
 *    已知权衡记录于 docs/architecture.md §2.4。
 */
import { randomBytes } from "node:crypto";

/** 16 字节 CSPRNG（128 位熵）→ base64（24 字符，'==' 填充），匹配 Next 的 nonce 解析正则。 */
export function generateCspNonce(): string {
  return randomBytes(16).toString("base64");
}

/** 构造单行 CSP 头。nonce 只进 script-src；isDev 追加 'unsafe-eval'。 */
export function buildCspHeader(nonce: string, opts: { isDev?: boolean } = {}): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // dev：React/Next 需要 eval 做错误栈重建与 HMR；production 绝不出现
    ...(opts.isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // style-src 保持现状（内联样式依赖面广，本次不动 —— 已知权衡）
    "style-src 'self' 'unsafe-inline'",
    // img/media 放开 *：用户 Markdown 可引用外部图片/音视频，属产品能力
    "img-src * data: blob:",
    "media-src * data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}
