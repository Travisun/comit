import { AppError } from "@/core/errors";
import { withPermission } from "@/lib/permissions";
import { ok } from "@/lib/http";
import { MAIL_TEMPLATES, resetTemplateOverride } from "@/lib/mail-templates";
import { logAdmin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/templates/[key]/reset — drop the override, restore built-in copy. */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  return withPermission(req, "admin.templates", async ({ user }) => {
    const { key } = await params;
    if (!MAIL_TEMPLATES.some((t) => t.key === key)) {
      throw new AppError(`未知模板 / Unknown template: ${key}`, 404, "not_found");
    }
    await resetTemplateOverride(key);
    await logAdmin(user.id, "template.reset", "mail_template", null, key);
    return ok({ ok: true });
  });
}
