import { z } from "zod";
import { unauthorized } from "@/core/errors";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { createApiToken, listApiTokens, TOKEN_SCOPES } from "@/lib/tokens";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/tokens — list own API tokens (hashes never leave the server). */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    // 复用统一错误工具 → { error, code: "unauthorized" } envelope（withApi 兜底转换）
    if (!user) throw unauthorized();
    return ok({
      tokens: await listApiTokens(user.id),
      availableScopes: TOKEN_SCOPES,
    });
  });
}

const postSchema = z.object({
  name: z.string().trim().min(1, "请填写令牌名称 / Name required").max(120),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1, "至少选择一个权限 / Pick at least one scope"),
});

/** POST /api/me/tokens — create a token; the full token is shown exactly once. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(postSchema, await req.json().catch(() => null));
    const { id, token } = await createApiToken(auth.user.id, body.name, [...body.scopes]);
    return ok({ id, token, message: "令牌仅此一次完整显示 / Shown only once" });
  });
}
