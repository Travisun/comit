import { z } from "zod";
import { withAdmin, ok, jsonBody } from "@/lib/http";
import { getSettings, setSettings, SETTINGS_DEFAULTS } from "@/lib/settings";
import { AppError } from "@/core/errors";
import { parseOrThrow, logAdmin } from "@/app/api/admin/_shared";
import { llmProvidersValueSchema } from "@/lib/llm";
import { OAUTH_PROVIDER_IDS, oauthCreds } from "@/lib/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_KEYS = new Set(Object.keys(SETTINGS_DEFAULTS));

/**
 * 简单文本键的长度上限：site.* 文本此前无校验直接透传落库，超长值会进
 * <title>/meta/footer。这里按各消费场景给上限；布尔键不在此列。
 */
const SITE_TEXT_LIMITS: Record<string, number> = {
  "site.name": 60,
  "site.tagline": 200,
  "site.description": 500,
  "site.keywords": 500,
  "site.ogImage": 2048,
  "site.twitter": 30,
  "site.copyright": 200,
  "site.beian": 100,
  "site.singleUser": 63,
};

/** GET /api/admin/settings — all settings; the LLM apiKey is reduced to a hasKey flag. */
export async function GET(req: Request) {
  return withAdmin(req, async () => {
    const all = await getSettings();
    const llm = all["moderation.llm"] as { apiKey?: string } | undefined;
    const llmProviders = all["llm.providers"] as
      { providers?: { apiKey?: string; hasKey?: boolean }[] } | undefined;
    const entries: Record<string, unknown> = {
      ...all,
      "moderation.llm": llm
        ? { ...llm, apiKey: undefined, hasKey: Boolean(llm.apiKey) }
        : { hasKey: false },
      // 每个 provider 的 apiKey 只回传 hasKey，明文永不出库
      "llm.providers": llmProviders
        ? {
            ...llmProviders,
            providers: (llmProviders.providers ?? []).map((p) => ({
              ...p,
              apiKey: undefined,
              hasKey: Boolean(p.apiKey),
            })),
          }
        : { providers: [], default: null },
    };
    // OAuth 凭证（DB 优先 / env 兜底）：密钥永不明文出库，只回传 hasSecret；
    // configured = 合并视图下凭证是否齐备（供登录 tab 的开关标签展示）
    const oauthRaw = (all["oauth.providers"] ?? {}) as Record<
      string,
      { clientId?: string; clientSecret?: string }
    >;
    const oauthMasked: Record<string, { clientId: string; hasSecret: boolean; configured: boolean }> = {};
    for (const prov of OAUTH_PROVIDER_IDS) {
      const creds = await oauthCreds(prov);
      oauthMasked[prov] = {
        clientId: oauthRaw[prov]?.clientId ?? "",
        hasSecret: Boolean(oauthRaw[prov]?.clientSecret),
        configured:
          prov === "linuxdo" || prov === "discourse"
            ? Boolean(creds.clientId && creds.clientSecret)
            : Boolean(creds.clientId),
      };
    }
    entries["oauth.providers"] = oauthMasked;
    // SMTP：pass 永不明文出库，只回传 hasPass
    const smtpRaw = (all["smtp"] ?? {}) as {
      host?: string;
      port?: number;
      secure?: boolean;
      user?: string;
      pass?: string;
      from?: string;
    };
    entries["smtp"] = {
      host: smtpRaw.host ?? "",
      port: smtpRaw.port ?? 587,
      secure: smtpRaw.secure ?? false,
      user: smtpRaw.user ?? "",
      from: smtpRaw.from ?? "",
      hasPass: Boolean(smtpRaw.pass),
    };
    return ok({ entries });
  });
}

const bodySchema = z.object({
  entries: z.record(z.string(), z.unknown()).refine(
    (entries) => Object.keys(entries).length > 0,
    { message: "entries 不能为空 / entries required" },
  ),
});

/** oauth.providers 的精确值校验：provider → { clientId, clientSecret }（文本，长度上限防滥用） */
const oauthProvidersValueSchema = z.record(
  z.string().max(32),
  z
    .object({
      clientId: z.string().max(500),
      clientSecret: z.string().max(500),
    })
    .strict(),
);

/** smtp 的精确值校验 */
const smtpValueSchema = z
  .object({
    host: z.string().max(255),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().max(255),
    pass: z.string().max(255),
    from: z.string().max(255),
  })
  .strict();

/**
 * ratelimit.buckets 的精确值校验：桶名 → { limit, windowSec }（其余键维持
 * 现状只查白名单，不扩散范围）。窗口上限 86400s（一天）、阈值上限 1e5。
 */
const bucketsValueSchema = z.record(
  z.string(),
  z
    .object({
      limit: z.number().int().min(1).max(100000),
      windowSec: z.number().int().min(1).max(86400),
    })
    .strict(),
);

/** POST /api/admin/settings — persist a whitelist of setting entries. */
export async function POST(req: Request) {
  return withAdmin(req, async ({ user }) => {
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    for (const [key, value] of Object.entries(body.entries)) {
      if (!KNOWN_KEYS.has(key)) {
        throw new AppError(`未知的设置项 / Unknown setting key: ${key}`, 400, "bad_key");
      }
      const textLimit = SITE_TEXT_LIMITS[key];
      if (textLimit !== undefined) {
        if (typeof value !== "string" || value.length > textLimit) {
          throw new AppError(
            `设置项的值不合法 / Invalid value for setting: ${key}（需为 ≤${textLimit} 字符的文本）`,
            400,
            "bad_value",
          );
        }
        continue;
      }
      if (key === "ratelimit.buckets" && !bucketsValueSchema.safeParse(value).success) {
        throw new AppError(`设置项的值不合法 / Invalid value for setting: ${key}`, 400, "bad_value");
      }
      if (key === "llm.providers" && !llmProvidersValueSchema.safeParse(value).success) {
        throw new AppError(`设置项的值不合法 / Invalid value for setting: ${key}`, 400, "bad_value");
      }
      if (key === "oauth.providers" && !oauthProvidersValueSchema.safeParse(value).success) {
        throw new AppError(`设置项的值不合法 / Invalid value for setting: ${key}`, 400, "bad_value");
      }
      if (key === "smtp" && !smtpValueSchema.safeParse(value).success) {
        throw new AppError(`设置项的值不合法 / Invalid value for setting: ${key}`, 400, "bad_value");
      }
    }

    // llm.providers 密钥保留语义：客户端不回传明文 —— apiKey 为空的提供商
    // 沿用库中已存密钥（按 id 匹配），避免"编辑其它字段就把密钥抹掉"
    const entriesToPersist: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body.entries)) {
      if (key === "llm.providers") {
        const incoming = value as {
          providers: { id: string; apiKey?: string }[];
          default: { providerId: string; model: string } | null;
        };
        const current = (await getSettings())["llm.providers"] as
          | { providers?: { id: string; apiKey?: string }[] }
          | undefined;
        entriesToPersist[key] = {
          ...incoming,
          providers: incoming.providers.map((p) => ({
            ...p,
            apiKey: p.apiKey || current?.providers?.find((x) => x.id === p.id)?.apiKey || "",
          })),
        };
        continue;
      }
      // oauth.providers 密钥保留语义：clientSecret 为空的提供商沿用库中已存密钥
      if (key === "oauth.providers") {
        const incoming = value as Record<string, { clientId?: string; clientSecret?: string }>;
        const current = (await getSettings())["oauth.providers"] as
          | Record<string, { clientSecret?: string }>
          | undefined;
        const merged: Record<string, { clientId: string; clientSecret: string }> = {};
        for (const [prov, v] of Object.entries(incoming)) {
          merged[prov] = {
            clientId: v?.clientId ?? "",
            clientSecret: v?.clientSecret || current?.[prov]?.clientSecret || "",
          };
        }
        entriesToPersist[key] = merged;
        continue;
      }
      // smtp 密码保留语义：pass 为空沿用库中已存密码
      if (key === "smtp") {
        const incoming = value as { pass?: string };
        const current = (await getSettings())["smtp"] as { pass?: string } | undefined;
        entriesToPersist[key] = { ...incoming, pass: incoming.pass || current?.pass || "" };
        continue;
      }
      entriesToPersist[key] = value;
    }

    await setSettings(entriesToPersist);
    await logAdmin(user.id, "settings.update", "settings", null, Object.keys(body.entries).join(", "));
    return ok({ ok: true });
  });
}
