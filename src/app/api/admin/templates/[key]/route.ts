import { z } from "zod";
import { AppError } from "@/core/errors";
import { withPermission } from "@/lib/permissions";
import { ok, jsonBody } from "@/lib/http";
import { MAIL_TEMPLATES, getTemplateOverride, setTemplateOverride } from "@/lib/mail-templates";
import { logAdmin, parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  subjectZh: z.string().max(500).optional(),
  subjectEn: z.string().max(500).optional(),
  bodyZh: z.string().max(20_000).optional(),
  bodyEn: z.string().max(20_000).optional(),
  enabled: z.boolean().optional(),
});

/**
 * POST /api/admin/templates/[key] — upsert the override for one template.
 * Empty-string fields mean "fall back to the built-in copy"; `enabled: false`
 * disables the template (mail channel skips sending).
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  return withPermission(req, "admin.templates", async ({ user }) => {
    const { key } = await params;
    if (!MAIL_TEMPLATES.some((t) => t.key === key)) {
      throw new AppError(`未知模板 / Unknown template: ${key}`, 404, "not_found");
    }
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    const current = await getTemplateOverride(key);
    const saved = await setTemplateOverride(key, body);
    await logAdmin(
      user.id,
      current ? "template.update" : "template.create",
      "mail_template",
      null,
      `${key} (enabled=${saved.enabled})`,
    );
    return ok({ ok: true, override: saved });
  });
}
