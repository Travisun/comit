/**
 * 桶清单（纯数据，零 import）— 客户端安全模块：admin 设置页等浏览器
 * 代码可直接运行时导入，不会把服务端依赖（@/db → pg）拖进客户端包。
 * 服务端执行逻辑（覆写解析、限流计数）在 buckets.ts，本文件只有形状与默认值。
 */

/** 后台单桶覆写：limit 与 windowSec 必须成对给出（与 admin 校验一致） */
export interface BucketOverride {
  limit: number;
  windowSec: number;
}

export interface RateBucket {
  name: BucketName;
  /** 窗口内允许的最大次数 / max hits per window */
  limit: number;
  /** 窗口长度（秒）/ window length in seconds */
  windowSec: number;
  /** 用途说明（中文） */
  zh: string;
  /** purpose (English) */
  en: string;
}

/**
 * 桶清单 —— 默认值即各调用点的现状值（或新设的合理值）。
 * 调整默认值只改这里；后台覆写存 DB，不进代码。
 */
export const RATE_BUCKETS = [
  { name: "auth.login", limit: 10, windowSec: 60, zh: "登录（按 IP）", en: "Login (per IP)" },
  { name: "auth.register", limit: 5, windowSec: 3600, zh: "注册（按 IP）", en: "Registration (per IP)" },
  {
    name: "auth.password",
    limit: 10,
    windowSec: 3600,
    zh: "找回密码 + 重置密码（按 IP）",
    en: "Password forgot + reset (per IP)",
  },
  {
    name: "auth.email",
    limit: 5,
    windowSec: 3600,
    zh: "邮箱换绑（按用户）+ 重发验证邮件（匿名按 IP）",
    en: "Email change (per user) + verification resend (per IP)",
  },
  {
    name: "auth.twofa",
    limit: 10,
    windowSec: 60,
    zh: "两步验证 setup/confirm/challenge（按 IP）",
    en: "2FA setup/confirm/challenge (per IP)",
  },
  { name: "write.post", limit: 10, windowSec: 3600, zh: "发文章/短动态（按用户）", en: "Post creation (per user)" },
  { name: "write.comment", limit: 30, windowSec: 60, zh: "发评论（按用户）", en: "Comment creation (per user)" },
  { name: "write.upload", limit: 20, windowSec: 60, zh: "图片上传（按用户）", en: "Media upload (per user)" },
  { name: "message.send", limit: 30, windowSec: 60, zh: "发私信（按用户）", en: "Direct message send (per user)" },
  {
    name: "action.social",
    limit: 60,
    windowSec: 60,
    zh: "关注/转发/收藏/拉黑 toggle（按用户）",
    en: "Follow / repost / bookmark / block toggle (per user)",
  },
  { name: "report.create", limit: 10, windowSec: 3600, zh: "提交举报（按用户）", en: "Report submission (per user)" },
  {
    name: "preview.markdown",
    limit: 30,
    windowSec: 60,
    zh: "Markdown 实时预览渲染（按用户）",
    en: "Markdown preview render (per user)",
  },
  { name: "mcp.api", limit: 60, windowSec: 60, zh: "MCP JSON-RPC 调用（按 API token）", en: "MCP JSON-RPC calls (per API token)" },
  { name: "client.error", limit: 30, windowSec: 60, zh: "客户端错误上报（按 IP）", en: "Client error reporting (per IP)" },
] as const;

export type BucketName = (typeof RATE_BUCKETS)[number]["name"];
