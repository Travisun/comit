/**
 * Typed config repository — reads process.env once (Laravel-style config
 * group access). Runtime-tunable settings live in the DB `settings` table
 * (see src/lib/settings.ts) and are edited from the admin panel.
 */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  app: {
    get url() {
      return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    },
    get rootDomain() {
      return process.env.ROOT_DOMAIN ?? "localhost";
    },
    name: "comit.sh",
    get isProd() {
      return process.env.NODE_ENV === "production";
    },
  },
  auth: {
    get secret() {
      return req("AUTH_SECRET", "dev-secret-insecure-please-change");
    },
    sessionCookie: "mb_session",
    pendingCookie: "mb_pending",
    sessionDays: 30,
  },
  mail: {
    get host() {
      return process.env.SMTP_HOST ?? "";
    },
    get port() {
      return Number(process.env.SMTP_PORT ?? 587);
    },
    get secure() {
      return process.env.SMTP_SECURE === "true";
    },
    get user() {
      return process.env.SMTP_USER ?? "";
    },
    get pass() {
      return process.env.SMTP_PASS ?? "";
    },
    get from() {
      return process.env.MAIL_FROM ?? "comit.sh <no-reply@localhost>";
    },
    get enabled() {
      return Boolean(process.env.SMTP_HOST);
    },
  },
  oauth: {
    github: {
      get clientId() {
        return process.env.GITHUB_CLIENT_ID ?? "";
      },
      get clientSecret() {
        return process.env.GITHUB_CLIENT_SECRET ?? "";
      },
    },
    google: {
      get clientId() {
        return process.env.GOOGLE_CLIENT_ID ?? "";
      },
      get clientSecret() {
        return process.env.GOOGLE_CLIENT_SECRET ?? "";
      },
    },
    linuxdo: {
      get clientId() {
        return process.env.LINUXDO_CLIENT_ID ?? "";
      },
      get clientSecret() {
        return process.env.LINUXDO_CLIENT_SECRET ?? "";
      },
    },
    x: {
      get clientId() {
        return process.env.X_CLIENT_ID ?? "";
      },
      get clientSecret() {
        return process.env.X_CLIENT_SECRET ?? "";
      },
    },
    discourse: {
      get url() {
        return process.env.DISCOURSE_SSO_URL ?? "";
      },
      get secret() {
        return process.env.DISCOURSE_SSO_SECRET ?? "";
      },
    },
    cfAccess: {
      get team() {
        return process.env.CF_ACCESS_TEAM ?? "";
      },
      get aud() {
        return process.env.CF_ACCESS_AUD ?? "";
      },
    },
  },
  queue: {
    get concurrency() {
      return Number(process.env.QUEUE_CONCURRENCY ?? 3);
    },
  },
  storage: {
    /** 附件存储驱动：local（默认，向后兼容）| r2（Cloudflare R2 S3 API） */
    get driver(): "local" | "r2" {
      return process.env.STORAGE_DRIVER === "r2" ? "r2" : "local";
    },
    // R2 凭据/桶名只经此读取（永不入日志）；完整性与回落判定见 src/lib/storage。
    // 字符串字段统一 trim（与 index.ts 必填校验对齐）：粘贴 env 带尾随空白不再
    // 造成「校验通过、端点/桶名却带空格」的隐性不一致。
    r2: {
      get accountId() {
        return (process.env.R2_ACCOUNT_ID ?? "").trim();
      },
      get accessKeyId() {
        return (process.env.R2_ACCESS_KEY_ID ?? "").trim();
      },
      get secretAccessKey() {
        return (process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
      },
      get bucket() {
        return (process.env.R2_BUCKET ?? "").trim();
      },
      /** 可选：自定义域或 r2.dev 公开地址 → 图片直连 R2/CDN，应用路由只服务存量本地文件 */
      get publicBaseUrl() {
        return (process.env.R2_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
      },
    },
  },
} as const;
