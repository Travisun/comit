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
