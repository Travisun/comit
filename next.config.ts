import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
