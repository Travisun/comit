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
    name: "auth.email.resend",
    limit: 3,
    windowSec: 600,
    zh: "重发验证邮件（按用户 / 按邮箱地址）",
    en: "Verification resend (per user / per email address)",
  },
  {
    name: "auth.twofa",
    limit: 10,
    windowSec: 60,
    zh: "两步验证 setup/confirm/challenge（按 IP）",
    en: "2FA setup/confirm/challenge (per IP)",
  },
  {
    name: "auth.twofa.account",
    limit: 10,
    windowSec: 300,
    zh: "两步验证 confirm/challenge（按用户，防代理池爆破第二因子）",
    en: "2FA confirm/challenge (per user, anti TOTP brute-force via IP rotation)",
  },
  {
    name: "auth.federated.callback",
    limit: 30,
    windowSec: 300,
    zh: "第三方登录回调（OAuth / Discourse SSO / CF Access，按 IP）",
    en: "Federated sign-in callbacks: OAuth, Discourse SSO, CF Access (per IP)",
  },
  {
    name: "auth.federated.account",
    limit: 10,
    windowSec: 3600,
    zh: "第三方登录成功次数（按外部身份）—— 换 IP 重放同一断言/票据时按 IP 的桶不计数，需按身份兜底",
    en: "Successful federated sign-ins (per external identity) — IP rotation defeats the per-IP bucket",
  },
  {
    name: "auth.login.account",
    limit: 10,
    windowSec: 900,
    zh: "登录失败（按账号标识，防分布式撞库）",
    en: "Login failures (per account identifier, anti distributed brute-force)",
  },
  {
    name: "auth.passkey",
    limit: 20,
    windowSec: 60,
    zh: "通行密钥注册/登录仪式（按 IP）",
    en: "Passkey registration/authentication (per IP)",
  },
  { name: "write.post", limit: 10, windowSec: 3600, zh: "发文章/短动态（按用户）", en: "Post creation (per user)" },
  {
    name: "write.post.edit",
    limit: 30,
    windowSec: 60,
    zh: "编辑已有内容（按用户）—— 已发布内容每次保存都要重回审核管线，无上限即可刷爆审核队列与钩子开销",
    en: "Post editing (per user) — published edits re-enter the review pipeline",
  },
  { name: "write.comment", limit: 30, windowSec: 60, zh: "发评论（按用户）", en: "Comment creation (per user)" },
  { name: "write.upload", limit: 20, windowSec: 60, zh: "图片上传（按用户）", en: "Media upload (per user)" },
  { name: "message.send", limit: 30, windowSec: 60, zh: "发私信（按用户）", en: "Direct message send (per user)" },
  {
    name: "read.messages",
    limit: 120,
    windowSec: 60,
    zh: "私信读取：会话列表 + 消息分页（按用户）",
    en: "DM reads: conversations + message pages (per user)",
  },
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
  {
    name: "mcp.ip",
    limit: 120,
    windowSec: 60,
    zh: "MCP 端点请求（按 IP，鉴权前即计数：挡未认证爆破/伪造 token 打库的探测流量）",
    en: "MCP endpoint requests (per IP, counted before auth: caps unauthenticated probing)",
  },
  {
    name: "export.create",
    limit: 3,
    windowSec: 3600,
    zh: "创建数据导出任务（按用户）",
    en: "Export job creation (per user)",
  },
  {
    name: "token.create",
    limit: 10,
    windowSec: 3600,
    zh: "签发 API 令牌（按用户）—— 令牌是绕过会话体系的长期 bearer 凭证，签发频率必须受限",
    en: "API token issuance (per user) — long-lived bearer credentials outside the session system",
  },
  {
    name: "invite.create",
    limit: 10,
    windowSec: 3600,
    zh: "生成邀请码（按用户）—— 邀请制站点的准入通道，配额之外再限速以防反复撤销/重发",
    en: "Invite code generation (per user)",
  },
  {
    name: "webhook.manage",
    limit: 20,
    windowSec: 3600,
    zh: "Webhook 端点创建/改址/删除（按用户）—— 每次注册都要过一次出站 URL 校验，且端点决定后续投递扇出规模",
    en: "Webhook endpoint create/update/delete (per user)",
  },
  {
    name: "webhook.test",
    limit: 5,
    windowSec: 60,
    zh: "Webhook 测试投递（按用户）—— 服务端代替用户向任意 URL 发起请求，属出站探测面，必须限速",
    en: "Webhook test ping (per user) — server-side request to a user-supplied URL",
  },
  { name: "client.error", limit: 30, windowSec: 60, zh: "客户端错误上报（按 IP）", en: "Client error reporting (per IP)" },
] as const;

export type BucketName = (typeof RATE_BUCKETS)[number]["name"];
