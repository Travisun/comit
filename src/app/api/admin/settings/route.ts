import { z } from "zod";
import { withAdmin, ok, jsonBody } from "@/lib/http";
import { getSettings, setSettings, SETTINGS_DEFAULTS } from "@/lib/settings";
import { AppError } from "@/core/errors";
import { parseOrThrow, logAdmin } from "@/app/api/admin/_shared";
import { config } from "@/core/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_KEYS = new Set(Object.keys(SETTINGS_DEFAULTS));

/** GET /api/admin/settings — all settings; the LLM apiKey is reduced to a hasKey flag. */
export async function GET(req: Request) {
  return withAdmin(req, async () => {
    const all = await getSettings();
    const llm = all["moderation.llm"] as { apiKey?: string } | undefined;
    const entries: Record<string, unknown> = {
      ...all,
      "moderation.llm": llm
        ? { ...llm, apiKey: undefined, hasKey: Boolean(llm.apiKey) }
        : { hasKey: false },
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

/** POST /api/admin/settings — persist a whitelist of setting entries. */
export async function POST(req: Request) {
  return withAdmin(req, async ({ user }) => {
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    for (const key of Object.keys(body.entries)) {
      if (!KNOWN_KEYS.has(key)) {
        throw new AppError(`未知的设置项 / Unknown setting key: ${key}`, 400, "bad_key");
      }
    }

    await setSettings(body.entries);
    await logAdmin(user.id, "settings.update", "settings", null, Object.keys(body.entries).join(", "));
    return ok({ ok: true });
  });
}
