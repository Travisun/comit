import { z } from "zod";
import { jsonBody, ok, withUser } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
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
    // 渲染管线较重（KaTeX/Shiki），per-user 30 次/分钟
    rateLimit(`md-preview:${auth.user.id}`, 30, 60_000);
    const { content } = parseWith(previewSchema, await jsonBody(req));
    const { html } = await renderMarkdown(content);
    return ok({ html });
  });
}
