import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withUser } from "@/lib/http";

const bodySchema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

/** POST /api/reports — file a report against a post / comment / user. */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const parsed = bodySchema.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("参数错误 / Invalid payload", 400, "bad_request");
    const { targetType, targetId, reason } = parsed.data;

    await db.insert(reports).values({
      reporterId: auth.user.id,
      targetType,
      targetId,
      reason,
    });
    return ok();
  });
}
