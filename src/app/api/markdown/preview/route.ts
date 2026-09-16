import { z } from "zod";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";
import { renderMarkdown } from "@/lib/markdown/server";
import { parseWith } from "@/app/api/posts/_shared";

/**
 * POST /api/markdown/preview — { content } → { html }
 * Same server pipeline as published posts (GFM/KaTeX/Shiki/mermaid markers/
 * external-link guard), used by the editor's live preview.
 */
const previewSchema = z.object({
  content: z.string().max(200_000),
});

export async function POST(req: Request): Promise<Response> {
  return withUser(req, async (auth) => {
    // 渲染管线较重（KaTeX/Shiki）：桶 preview.markdown，per-user 30 次/分钟
    await rateLimitBucket("preview.markdown", auth.user.id);
    const { content } = parseWith(previewSchema, await jsonBody(req));
    const { html } = await renderMarkdown(content);
    return ok({ html });
  });
}
