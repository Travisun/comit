import { withPermission } from "@/lib/permissions";
import { ok } from "@/lib/http";
import { MAIL_TEMPLATES, hasCustomCopy, listOverrides } from "@/lib/mail-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/templates — registry with each template's merged override state. */
export async function GET(req: Request) {
  return withPermission(req, "admin.templates", async () => {
    const overrides = await listOverrides();
    const templates = MAIL_TEMPLATES.map((def) => {
      const override = overrides[def.key] ?? null;
      return {
        ...def,
        override,
        customized: hasCustomCopy(override),
        enabled: override ? override.enabled : true,
      };
    });
    return ok({ templates });
  });
}
