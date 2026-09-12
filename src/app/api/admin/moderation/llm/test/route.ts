import { z } from "zod";
import { withAdmin, ok, jsonBody } from "@/lib/http";
import { llmReview } from "@/lib/moderation";
import { parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().trim().min(1, "请输入测试文本 / Text required").max(8000),
});

/** POST /api/admin/moderation/llm/test — dry-run the LLM review pipeline. */
export async function POST(req: Request) {
  return withAdmin(req, async () => {
    const body = parseOrThrow(bodySchema, await jsonBody(req));
    const result = await llmReview(body.text);
    return ok({ result });
  });
}
