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
} as const;
