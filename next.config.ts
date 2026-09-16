import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 不对外泄露框架指纹（X-Powered-By: Next.js）
  poweredByHeader: false,
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "sharp",
    "@modelcontextprotocol/sdk",
    "unified",
    "shiki",
    "rehype-pretty-code",
    "nodemailer",
  ],
  experimental: {
    // 全站页面均为 force-dynamic 且无 loading 边界，默认「进入视口即预取」
    // 会让每次滚动产生大量在途 RSC 请求；快速切换页面时路由缓存条目被过早
    // 逐出/复用，命中 flight 客户端竞态（enqueueModel 崩溃，刷新后恢复）。
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
    // 安装面安全头唯一出处（src/proxy.ts 原本重复设置的 X-Frame-Options /
    // X-Content-Type-Options / Referrer-Policy 已收敛至此；proxy 只保留 rewrite）。
    // "/(.*)" 覆盖页面、/api route handlers 与静态资源，含 matcher 被排除的
    // _next/static、api/auth/oauth、api/mcp 等路径，无死角。
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];
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
