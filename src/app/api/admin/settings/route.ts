import { z } from "zod";
import { withAdmin, ok, jsonBody } from "@/lib/http";
import { getSettings, setSettings, SETTINGS_DEFAULTS } from "@/lib/settings";
import { AppError } from "@/core/errors";
import { parseOrThrow, logAdmin } from "@/app/api/admin/_shared";
import { config } from "@/core/config";
import { llmProvidersValueSchema } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_KEYS = new Set(Object.keys(SETTINGS_DEFAULTS));

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
    // OAuth 凭证仅存在于环境变量 —— 后台可查看配置状态（不可改）
    const oauthEnv = {
      github: Boolean(config.oauth.github.clientId),
      google: Boolean(config.oauth.google.clientId),
      x: Boolean(config.oauth.x.clientId),
      linuxdo: Boolean(config.oauth.linuxdo.clientId),
      discourse: Boolean(config.oauth.discourse.url && config.oauth.discourse.secret),
      cfaccess: Boolean(config.oauth.cfAccess.team),
    };
    return ok({ entries, oauthEnv });
  });
}

const bodySchema = z.object({
  entries: z.record(z.string(), z.unknown()).refine(
    (entries) => Object.keys(entries).length > 0,
    { message: "entries 不能为空 / entries required" },
  ),
});

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
      if (key === "ratelimit.buckets" && !bucketsValueSchema.safeParse(value).success) {
        throw new AppError(`设置项的值不合法 / Invalid value for setting: ${key}`, 400, "bad_value");
      }
      if (key === "llm.providers" && !llmProvidersValueSchema.safeParse(value).success) {
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
      entriesToPersist[key] = value;
    }

    await setSettings(entriesToPersist);
    await logAdmin(user.id, "settings.update", "settings", null, Object.keys(body.entries).join(", "));
    return ok({ ok: true });
  });
}
