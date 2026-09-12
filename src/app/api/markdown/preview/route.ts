import { z } from "zod";
import { jsonBody, ok, withUser } from "@/lib/http";
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
  return withUser(req, async () => {
    const { content } = parseWith(previewSchema, await jsonBody(req));
    const { html } = await renderMarkdown(content);
    return ok({ html });
  });
}
