import { GitHub, Google, Twitter, generateCodeVerifier } from "arctic";
import { createHash, createHmac, randomBytes } from "crypto";
import { config } from "@/core/config";
import { httpRequest } from "@/core/http-client";
import { forbidden } from "@/core/errors";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { getSetting } from "@/lib/settings";

/**
 * Federated identity: OAuth2 (GitHub / Google / X), Discourse SSO provider,
 * Cloudflare Access JWT. All return a normalized profile; first login
 * auto-registers the account.
 *
 * 凭证来源：管理后台设置（settings 表 oauth.providers）优先，字段留空回落
 * 环境变量（config.oauth.*）—— 已有 env 部署零迁移，后台改完即时生效
 * （settings 自带 10s 进程缓存）。
 */
export interface FederatedProfile {
  provider: string;
  providerAccountId: string;
  email: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
  /**
   * 合成邮箱：provider 未提供真实邮箱、由本方用账号句柄拼出的唯一 noreply
   * 地址（如 X 的 @users.noreply.x.com）。身份由 provider 证明，但邮箱本身
   * 收不到验证邮件 —— 自动注册时视同已验证（否则用户 100% 被验证门槛锁死），
   * 但按邮箱自动绑定仍由 emailVerified 单独门控，合成邮箱永远不允许绑入
   * 既有账户。
   */
  emailSynthetic?: boolean;
}

export type OAuthProviderId = "github" | "google" | "x" | "linuxdo" | "discourse" | "cfaccess";

export const OAUTH_PROVIDER_IDS: OAuthProviderId[] = [
  "github",
  "google",
  "x",
  "linuxdo",
  "discourse",
  "cfaccess",
];

export interface OAuthCreds {
  /** github/google/x/linuxdo=Client ID；discourse=SSO 地址；cfaccess=Team 域名 */
  clientId: string;
  /** 对应密钥：client secret / HMAC secret / AUD（cfaccess 可空） */
  clientSecret: string;
}

/** env 侧凭证（config.oauth 的扁平化视图，语义映射见 OAuthCreds）。 */
function envCreds(provider: OAuthProviderId): OAuthCreds {
  switch (provider) {
    case "github":
      return { clientId: config.oauth.github.clientId, clientSecret: config.oauth.github.clientSecret };
    case "google":
      return { clientId: config.oauth.google.clientId, clientSecret: config.oauth.google.clientSecret };
    case "x":
      return { clientId: config.oauth.x.clientId, clientSecret: config.oauth.x.clientSecret };
    case "linuxdo":
      return { clientId: config.oauth.linuxdo.clientId, clientSecret: config.oauth.linuxdo.clientSecret };
    case "discourse":
      return { clientId: config.oauth.discourse.url, clientSecret: config.oauth.discourse.secret };
    case "cfaccess":
      return { clientId: config.oauth.cfAccess.team, clientSecret: config.oauth.cfAccess.aud };
  }
}

/** 合并视图：settings 有值用 settings，逐字段回落 env。 */
export async function oauthCreds(provider: OAuthProviderId): Promise<OAuthCreds> {
  const db = await getSetting("oauth.providers");
  const entry = db?.[provider];
  const env = envCreds(provider);
  return {
    clientId: entry?.clientId?.trim() || env.clientId,
    clientSecret: entry?.clientSecret?.trim() || env.clientSecret,
  };
}

/* ---------------------------- OAuth2 (arctic) --------------------------- */

export async function oauthEnabled(provider: string): Promise<boolean> {
  if (!OAUTH_PROVIDER_IDS.includes(provider as OAuthProviderId)) return false;
  const c = await oauthCreds(provider as OAuthProviderId);
  switch (provider) {
    case "linuxdo":
    case "discourse":
      return Boolean(c.clientId && c.clientSecret);
    default:
      return Boolean(c.clientId);
  }
}

export async function createOAuthUrl(
  provider: string,
  state: string,
): Promise<{ url: URL; codeVerifier?: string }> {
  if (provider === "github") {
    const c = await oauthCreds("github");
    const client = new GitHub(c.clientId, c.clientSecret, `${config.app.url}/api/auth/oauth/callback/github`);
    return { url: client.createAuthorizationURL(state, ["read:user", "user:email"]) };
  }
  const codeVerifier = generateCodeVerifier();
  if (provider === "google") {
    const c = await oauthCreds("google");
    const client = new Google(c.clientId, c.clientSecret, `${config.app.url}/api/auth/oauth/callback/google`);
    return { url: client.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]), codeVerifier };
  }
  if (provider === "x") {
    const c = await oauthCreds("x");
    const client = new Twitter(c.clientId, c.clientSecret, `${config.app.url}/api/auth/oauth/callback/x`);
    return { url: client.createAuthorizationURL(state, codeVerifier, ["users.read", "tweet.read"]), codeVerifier };
  }
  if (provider === "linuxdo") {
    const c = await oauthCreds("linuxdo");
    // LinuxDo Connect：纯 OAuth2 授权码流程（机密客户端，无 PKCE、无 scope）
    const url = new URL("https://connect.linux.do/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", c.clientId);
    url.searchParams.set("redirect_uri", `${config.app.url}/api/auth/oauth/callback/linuxdo`);
    url.searchParams.set("state", state);
    return { url };
  }
  throw forbidden(`Unknown OAuth provider: ${provider}`);
}

export async function exchangeOAuthCode(
  provider: string,
  code: string,
  codeVerifier?: string,
): Promise<FederatedProfile> {
  let accessToken: string;
  if (provider === "github") {
    const c = await oauthCreds("github");
    const client = new GitHub(c.clientId, c.clientSecret, `${config.app.url}/api/auth/oauth/callback/github`);
    accessToken = (await client.validateAuthorizationCode(code)).accessToken();
  } else if (provider === "google") {
    const c = await oauthCreds("google");
    const client = new Google(c.clientId, c.clientSecret, `${config.app.url}/api/auth/oauth/callback/google`);
    accessToken = (await client.validateAuthorizationCode(code, codeVerifier ?? "")).accessToken();
  } else if (provider === "x") {
    const c = await oauthCreds("x");
    const client = new Twitter(c.clientId, c.clientSecret, `${config.app.url}/api/auth/oauth/callback/x`);
    accessToken = (await client.validateAuthorizationCode(code, codeVerifier ?? "")).accessToken();
  } else if (provider === "linuxdo") {
    const c = await oauthCreds("linuxdo");
    const tokenRes = await httpRequest("https://connect.linux.do/oauth2/token", {
      method: "POST",
      timeoutMs: 10_000,
      label: "oauth:linuxdo.token",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: `${config.app.url}/api/auth/oauth/callback/linuxdo`,
      }),
    });
    if (!tokenRes.ok) throw new Error(`linuxdo token exchange failed: ${tokenRes.status}`);
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    accessToken = tokenJson.access_token ?? "";
    if (!accessToken) throw new Error("linuxdo token exchange returned no access_token");
  } else {
    throw forbidden(`Unknown OAuth provider: ${provider}`);
  }
  const profile = await httpRequest<Record<string, unknown>>(profileEndpoint(provider), {
    timeoutMs: 10_000,
    label: `oauth:${provider}.profile`,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "comit.sh" },
  });
  if (!profile.ok) throw new Error(`${provider} profile fetch failed: ${profile.status}`);
  const json = await profile.json();
  return normalizeProfile(provider, json, accessToken);
}

function profileEndpoint(provider: string): string {
  switch (provider) {
    case "github":
      return "https://api.github.com/user";
    case "google":
      return "https://openidconnect.googleapis.com/v1/userinfo";
    case "x":
      return "https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name";
    case "linuxdo":
      return "https://connect.linux.do/api/user";
    default:
      throw forbidden("unknown provider");
  }
}

async function normalizeProfile(
  provider: string,
  json: Record<string, unknown>,
  accessToken: string,
): Promise<FederatedProfile> {
  if (provider === "github") {
    let email = (json.email as string | null) ?? null;
    // /user 的 email 是用户公开展示邮箱，GitHub 仅允许已验证邮箱设为公开，
    // 因此该路径可视为已验证；/user/emails 兜底则必须看 verified 标志。
    let verified = email != null;
    if (!email) {
      // private emails fallback
      const r = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "comit.sh" },
      });
      if (r.ok) {
        const emails = (await r.json()) as { email: string; primary: boolean; verified: boolean }[];
        const primaryVerified = emails.find((e) => e.primary && e.verified);
        if (primaryVerified) {
          email = primaryVerified.email;
          verified = true;
        } else {
          // 兜底可能是未验证的次要邮箱：email 仅作注册占位，
          // emailVerified=false —— 不允许据此按邮箱自动绑定既有账户
          email = emails[0]?.email ?? null;
          verified = false;
        }
      }
    }
    if (!email) throw forbidden("GitHub 账号没有可用的邮箱 / GitHub account has no accessible email");
    return {
      provider,
      providerAccountId: String(json.id),
      email,
      displayName: (json.name as string) ?? (json.login as string),
      username: json.login as string,
      avatarUrl: json.avatar_url as string,
      emailVerified: verified,
    };
  }
  if (provider === "google") {
    return {
      provider,
      providerAccountId: String(json.sub),
      email: json.email as string,
      displayName: (json.name as string) ?? (json.email as string),
      avatarUrl: json.picture as string,
      emailVerified: Boolean(json.email_verified),
    };
  }
  if (provider === "linuxdo") {
    return {
      provider,
      providerAccountId: String(json.id),
      email: (json.email as string) ?? "",
      displayName: (json.name as string) ?? (json.username as string),
      username: json.username as string,
      avatarUrl: (json.avatar_url as string) ?? undefined,
      // linux.do 账号要求激活；trust_level>=1 是替代信任信号（surrogate
      // trust signal）：平台侧已用其他方式确认账号可信，视同邮箱已验证
      emailVerified: Boolean(json.active) || Number(json.trust_level ?? 0) >= 1,
    };
  }
  // x
  const data = json.data as Record<string, string>;
  return {
    provider,
    providerAccountId: data.id,
    email: `${data.username}@users.noreply.x.com`, // X no longer exposes email
    displayName: data.name ?? data.username,
    username: data.username,
    avatarUrl: data.profile_image_url,
    emailVerified: false,
    // 合成 noreply 地址：身份由 X 证明，但邮箱本身无法完成验证流程
    emailSynthetic: true,
  };
}

/* ------------------------- Discourse SSO provider ----------------------- */

/**
 * We act as an SSO CLIENT; a Discourse forum is the SSO provider.
 * Flow: /api/auth/sso/discourse → redirect with base64(payload)+sig →
 * Discourse validates & redirects back with its own payload+sig → we verify
 * HMAC-SHA256 and extract the user.
 */
export async function discourseSsoStartUrl(nonce: string, returnPath: string): Promise<string> {
  const c = await oauthCreds("discourse");
  const payload = Buffer.from(
    JSON.stringify({ nonce, return_sso_url: `${config.app.url}${returnPath}` }),
  ).toString("base64");
  const sig = createHmac("sha256", c.clientSecret).update(payload).digest("hex");
  return `${c.clientId}?sso=${encodeURIComponent(payload)}&sig=${sig}`;
}

export async function verifyDiscourseCallback(sso: string, sig: string): Promise<FederatedProfile | null> {
  const c = await oauthCreds("discourse");
  const expected = createHmac("sha256", c.clientSecret).update(sso).digest("hex");
  if (expected !== sig) return null;
  const data = new URLSearchParams(Buffer.from(sso, "base64").toString());
  return {
    provider: "discourse",
    providerAccountId: String(data.get("external_id") ?? data.get("id") ?? data.get("username") ?? ""),
    email: String(data.get("email") ?? ""),
    displayName: String(data.get("name") || data.get("username") || "User"),
    username: data.get("username") ?? undefined,
    avatarUrl: data.get("avatar_url") ?? undefined,
    emailVerified: true,
  };
}

/* --------------------------- Cloudflare Access -------------------------- */

export async function verifyCfAccessJwt(jwt: string): Promise<FederatedProfile | null> {
  const c = await oauthCreds("cfaccess");
  const team = c.clientId;
  if (!team) return null;
  const certs = createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(jwt, certs, {
      issuer: `https://${team}.cloudflareaccess.com`,
      audience: c.clientSecret || undefined,
    });
    return {
      provider: "cfaccess",
      providerAccountId: String(payload.sub ?? ""),
      email: String(payload.email ?? ""),
      displayName: String(payload.name || payload.email || "User"),
      emailVerified: true,
    };
  } catch {
    return null;
  }
}

export function gravatarFallback(): string {
  return `https://www.gravatar.com/avatar/${createHash("md5").update(randomBytes(8)).digest("hex")}?d=mp`;
}
