import { z } from "zod";
import { withAdmin, ok } from "@/lib/http";
import { getSetting, setSettings } from "@/lib/settings";
import { parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 审核接入系统 LLM 能力（llm.providers 多提供商）：本端点只保存
 * 模型选择（providerId + model，空 = 平台默认模型）、温度与提示词；
 * 接口地址与密钥统一在 站点设置 → AI 模型 维护。旧版 moderation.llm 的
 * baseURL/apiKey 字段原样保留（llm.providers 未配置时的兼容回退）。
 */
const llmSchema = z.object({
  /** 空 = 平台默认模型（llm.providers.default） */
  providerId: z.string().max(40).optional().default(""),
  model: z.string().max(120).optional().default(""),
  temperature: z.number().min(0).max(2),
  prompt: z.string().trim().min(1, "提示词必填 / Prompt required").max(4000),
  /** RLCD 数据格式（Qwen-RLCD 审核服务对接） */
  rlcd: z.boolean().optional().default(false),
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
    const body = parseOrThrow(bodySchema, await req.json().catch(() => null));

    const prev = await getSetting("moderation.llm");

    await setSettings({
      "moderation.reviewMode": body.reviewMode,
      "moderation.keywordsEnabled": body.keywordsEnabled,
      "moderation.llmFailMode": body.failMode,
      "moderation.llm": {
        // 系统提供商模型选择（审核专用覆盖；空 = 平台默认）
        providerId: body.llm.providerId,
        model: body.llm.model,
        temperature: body.llm.temperature,
        prompt: body.llm.prompt,
        // RLCD 数据格式开关（开启后使用内置 RLCD 提示词与 json_schema 约束）
        rlcd: body.llm.rlcd,
        // 旧版单提供商字段原样保留（兼容回退，不再由本端点维护）
        baseURL: prev.baseURL ?? "https://api.openai.com/v1",
        apiKey: prev.apiKey ?? "",
      },
    });

    return ok({ ok: true });
  });
}
