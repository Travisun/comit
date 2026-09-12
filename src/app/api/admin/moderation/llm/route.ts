import { z } from "zod";
import { withAdmin, ok, jsonBody } from "@/lib/http";
import { getSetting, setSettings } from "@/lib/settings";
import { parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const llmSchema = z.object({
  baseURL: z.url("Base URL 格式不正确 / Invalid URL").max(500),
  /** empty string ⇒ keep the existing key */
  apiKey: z.string().max(500).optional().default(""),
  model: z.string().trim().min(1, "模型必填 / Model required").max(120),
  temperature: z.number().min(0).max(2),
  prompt: z.string().trim().min(1, "提示词必填 / Prompt required").max(4000),
});

const bodySchema = z.object({
  reviewMode: z.enum(["off", "llm", "manual"]),
  keywordsEnabled: z.boolean(),
  failMode: z.enum(["open", "closed"]),
  llm: llmSchema,
});

/** POST /api/admin/moderation/llm — save the LLM review configuration. */
export async function POST(req: Request) {
  return withAdmin(req, async () => {
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    const prev = await getSetting("moderation.llm");
    const apiKey = body.llm.apiKey === "" ? prev.apiKey : body.llm.apiKey;

    await setSettings({
      "moderation.reviewMode": body.reviewMode,
      "moderation.keywordsEnabled": body.keywordsEnabled,
      "moderation.llmFailMode": body.failMode,
      "moderation.llm": {
        baseURL: body.llm.baseURL,
        apiKey,
        model: body.llm.model,
        temperature: body.llm.temperature,
        prompt: body.llm.prompt,
      },
    });

    return ok({ ok: true, hasKey: Boolean(apiKey) });
  });
}
