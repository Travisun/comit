import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { extBadgeGrants, extBadges } from "@/db/schema";
import { AppError } from "@/core/errors";
import { jsonBody, ok, withAdmin } from "@/lib/http";
import { logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RE = /^[a-z0-9_-]{2,40}$/;
const ICON_KEYS = ["medal", "crown", "shield", "sparkles", "heart", "pen", "code", "palette", "rocket", "award", "star", "users", "wrench", "book", "flag", "zap"] as const;
const STYLE_KEYS = ["official", "ops", "admin", "genesis", "cute", "writer", "dev", "designer", "slate"] as const;

const createSchema = z.object({
  key: z.string().regex(KEY_RE, "key 仅限小写字母/数字/-_").optional(),
  name: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(24),
  icon: z.enum(ICON_KEYS).default("medal"),
  style: z.enum(STYLE_KEYS).default("slate"),
  description: z.string().trim().max(200).optional(),
});

/** GET /api/admin/badges — 徽章目录 + 颁发人数。 */
export async function GET(req: Request) {
  return withAdmin(req, async () => {
    const rows = await db
      .select({
        id: extBadges.id,
        key: extBadges.key,
        name: extBadges.name,
        text: extBadges.text,
        icon: extBadges.icon,
        style: extBadges.style,
        description: extBadges.description,
        enabled: extBadges.enabled,
        sortOrder: extBadges.sortOrder,
        createdAt: extBadges.createdAt,
        grants: count(extBadgeGrants.id),
      })
      .from(extBadges)
      .leftJoin(extBadgeGrants, eq(extBadgeGrants.badgeId, extBadges.id))
      .groupBy(extBadges.id)
      .orderBy(extBadges.sortOrder, desc(extBadges.createdAt));
    return ok({ badges: rows.map((r) => ({ ...r, grants: Number(r.grants) })) });
  });
}

/** POST /api/admin/badges — 新建徽章。 */
export async function POST(req: Request) {
  return withAdmin(req, async ({ user }) => {
    const parsed = createSchema.safeParse(await jsonBody(req).catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        `参数错误：${parsed.error.issues[0]?.message ?? "invalid"}`,
        400,
        "bad_request",
      );
    }
    const d = parsed.data;
    const key = d.key ?? `badge-${Date.now().toString(36)}`;
    try {
      const [row] = await db
        .insert(extBadges)
        .values({
          key,
          name: d.name,
          text: d.text,
          icon: d.icon,
          style: d.style,
          description: d.description ?? null,
        })
        .returning({ id: extBadges.id });
      await logAdmin(user.id, "badge.create", "badge", row.id, `${d.name} (${key})`);
      return ok({ id: row.id, key });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("ext_badges_key_key") || msg.includes("duplicate key")) {
        throw new AppError("徽章 key 已存在 / badge key already exists", 409, "conflict");
      }
      throw err;
    }
  });
}
