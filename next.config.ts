import type { NextConfig } from "next";
import { runInstanceGuard } from "./scripts/lib/instance-guard.mjs";

// dev 启动兜底（编译开始前执行）：postinstall 只在依赖变更时运行，若安装
// 发生在 dev server 运行期间、或 .next 曾被手动清除，这里对 next 实例连续性
// 再校验一次，引用已消失实例路径的 .next/dev 缓存直接清除。策略与实现见
// scripts/lib/instance-guard.mjs。
runInstanceGuard({ log: (msg) => console.log(msg) });

const nextConfig: NextConfig = {
  // 不对外泄露框架指纹（X-Powered-By: Next.js）
  poweredByHeader: false,
  // 用户名主页：/{username} ⇒ /u/{username}。用 afterFiles 级 rewrites（文件
  // 路由优先，/settings /hot 等真实页面先命中，故无需排除保留字表）；多段
  // 路径与含点路径天然不匹配。此前用 proxy.ts(middleware) rewrite——middleware
  // 改写携带绝对地址（经 X-Forwarded-Proto 重建为 https），Next router 对带
  // protocol 的改写会发起真实网络代理跳转（EPROTO → 500，单段路径经反代必炸）。
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/:username([A-Za-z0-9_-]+)",
          destination: "/u/:username",
        },
      ],
      fallback: [],
    };
  },
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "sharp",
    "@modelcontextprotocol/sdk",
    "unified",
    "shiki",
    "rehype-pretty-code",
    "nodemailer",
    // AWS SDK 体积大且依赖 Node 内建（crypto/net），保持外部化避免打进 server bundle
    "@aws-sdk/client-s3",
  ],
  experimental: {
    // 动态路由预取策略（配合各路由组 loading.tsx 流式边界）：全站 force-dynamic
    // + 默认「进入视口即预取」会让每次滚动产生大量在途 RSC 请求；快速切换
    // 页面时在途流交叠是 flight 客户端竞态（enqueueModel 崩溃）的诱因之一。
    // dynamicOnHover：动态路由改为悬停时才预取（移动端仅在点击时加载）；
    // staleTimes：已访问页面在客户端路由缓存保留 30s，来回切换直接复用。
    dynamicOnHover: true,
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    // All user media is served from /api/media/* as pre-optimized WebP; we use
    // plain <img> for user content and next/image nowhere else.
    unoptimized: true,
  },
  async headers() {
    // 安装面安全头唯一出处（历史上有 proxy.ts 重复设置的 X-Frame-Options /
    // X-Content-Type-Options / Referrer-Policy 已收敛至此；proxy 只保留 rewrite）。
    // "/(.*)" 覆盖页面、/api route handlers 与静态资源，含 matcher 被排除的
    // _next/static、api/auth/oauth、api/mcp 等路径，无死角。
    const isProd = process.env.NODE_ENV === "production";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      // CSP（净化器回归时的纵深防线）。取舍说明：
      //  - script 保留 'unsafe-inline'：Next.js 客户端引导依赖内联脚本，
      //    nonce 化需要动渲染管线，当前阶段以 object-src/base-uri/frame-ancestors
      //    这三项高价值指令为主；'unsafe-eval' 供 mermaid/KaTeX/开发期 React
      //    refresh 使用（sanitizer 已剥脚本标签，此头仅作二道防线）。
      //  - img/media 放开 *：用户 Markdown 可引用外部图片/音视频，属产品能力。
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src * data: blob:",
          "media-src * data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
        ].join("; "),
      },
    ];
    // HSTS 仅在「生产 + APP_URL 为 https」时下发：本地 http 联调或误配
    // 不会把浏览器锁进 https 一年。includeSubDomains 覆盖用户子域（同为本应用）。
    if (isProd && (process.env.APP_URL ?? "").startsWith("https://")) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }
    const rules: { source: string; headers: { key: string; value: string }[] }[] = [
      { source: "/(.*)", headers: securityHeaders },
    ];
    // dev 静态资源禁止入盘缓存：Turbopack dev 的 chunk URL 跨代际稳定而内容会
    // 随依赖变更/重编译变化，默认的 no-cache + ETag 协商可能让浏览器跨 dev server
    // 重启甚至跨浏览器重启复用上一代编译的字节（module factory / enqueueModel
    // 类错误根源之一）。浏览器磁盘缓存跨浏览器重启持久存在，必须 no-store 才能切断。
    if (process.env.NODE_ENV !== "production") {
      rules.push({
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      });
    }
    return rules;
  },
};

export default nextConfig;
