import { GitHub, Google, Twitter, generateCodeVerifier } from "arctic";
import { createHash, createHmac, randomBytes } from "crypto";
import { config } from "@/core/config";
import { httpRequest } from "@/core/http-client";
import { forbidden } from "@/core/errors";
import { jwtVerify, createRemoteJWKSet } from "jose";

/**
 * Federated identity: OAuth2 (GitHub / Google / X), Discourse SSO provider,
 * Cloudflare Access JWT. All return a normalized profile; first login
 * auto-registers the account.
 */
export interface FederatedProfile {
  provider: string;
  providerAccountId: string;
  email: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
}

/* ---------------------------- OAuth2 (arctic) --------------------------- */

export function oauthEnabled(provider: string): boolean {
  switch (provider) {
    case "github":
      return Boolean(config.oauth.github.clientId);
    case "google":
      return Boolean(config.oauth.google.clientId);
    case "x":
      return Boolean(config.oauth.x.clientId);
    case "linuxdo":
      return Boolean(config.oauth.linuxdo.clientId && config.oauth.linuxdo.clientSecret);
    case "discourse":
      return Boolean(config.oauth.discourse.url && config.oauth.discourse.secret);
    case "cfaccess":
      return Boolean(config.oauth.cfAccess.team);
    default:
      return false;
  }
}

export async function createOAuthUrl(
  provider: string,
  state: string,
): Promise<{ url: URL; codeVerifier?: string }> {
  if (provider === "github") {
    const client = new GitHub(config.oauth.github.clientId, config.oauth.github.clientSecret, `${config.app.url}/api/auth/oauth/callback/github`);
    return { url: client.createAuthorizationURL(state, ["read:user", "user:email"]) };
  }
  const codeVerifier = generateCodeVerifier();
  if (provider === "google") {
    const client = new Google(config.oauth.google.clientId, config.oauth.google.clientSecret, `${config.app.url}/api/auth/oauth/callback/google`);
    return { url: client.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]), codeVerifier };
  }
  if (provider === "x") {
    const client = new Twitter(config.oauth.x.clientId, config.oauth.x.clientSecret, `${config.app.url}/api/auth/oauth/callback/x`);
    return { url: client.createAuthorizationURL(state, codeVerifier, ["users.read", "tweet.read"]), codeVerifier };
  }
  if (provider === "linuxdo") {
    // LinuxDo Connect：纯 OAuth2 授权码流程（机密客户端，无 PKCE、无 scope）
    const url = new URL("https://connect.linux.do/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.oauth.linuxdo.clientId);
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
    const client = new GitHub(config.oauth.github.clientId, config.oauth.github.clientSecret, `${config.app.url}/api/auth/oauth/callback/github`);
    accessToken = (await client.validateAuthorizationCode(code)).accessToken();
  } else if (provider === "google") {
    const client = new Google(config.oauth.google.clientId, config.oauth.google.clientSecret, `${config.app.url}/api/auth/oauth/callback/google`);
    accessToken = (await client.validateAuthorizationCode(code, codeVerifier ?? "")).accessToken();
  } else if (provider === "x") {
    const client = new Twitter(config.oauth.x.clientId, config.oauth.x.clientSecret, `${config.app.url}/api/auth/oauth/callback/x`);
    accessToken = (await client.validateAuthorizationCode(code, codeVerifier ?? "")).accessToken();
  } else if (provider === "linuxdo") {
    const tokenRes = await httpRequest("https://connect.linux.do/oauth2/token", {
      method: "POST",
      timeoutMs: 10_000,
      label: "oauth:linuxdo.token",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.oauth.linuxdo.clientId,
        client_secret: config.oauth.linuxdo.clientSecret,
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
    if (!email) {
      // private emails fallback
      const r = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "comit.sh" },
      });
      if (r.ok) {
        const emails = (await r.json()) as { email: string; primary: boolean; verified: boolean }[];
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
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
      emailVerified: true,
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
      // linux.do 账号要求激活；信任级别 ≥1 视为已验证邮箱
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
  };
}

/* ------------------------- Discourse SSO provider ----------------------- */

/**
 * We act as an SSO CLIENT; a Discourse forum is the SSO provider.
 * Flow: /api/auth/sso/discourse → redirect with base64(payload)+sig →
 * Discourse validates & redirects back with its own payload+sig → we verify
 * HMAC-SHA256 and extract the user.
 */
export function discourseSsoStartUrl(nonce: string, returnPath: string): string {
  const payload = Buffer.from(
    JSON.stringify({ nonce, return_sso_url: `${config.app.url}${returnPath}` }),
  ).toString("base64");
  const sig = createHmac("sha256", config.oauth.discourse.secret).update(payload).digest("hex");
  return `${config.oauth.discourse.url}?sso=${encodeURIComponent(payload)}&sig=${sig}`;
}

export function verifyDiscourseCallback(sso: string, sig: string): FederatedProfile | null {
  const expected = createHmac("sha256", config.oauth.discourse.secret).update(sso).digest("hex");
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
  const team = config.oauth.cfAccess.team;
  if (!team) return null;
  const certs = createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(jwt, certs, {
      issuer: `https://${team}.cloudflareaccess.com`,
      audience: config.oauth.cfAccess.aud || undefined,
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
