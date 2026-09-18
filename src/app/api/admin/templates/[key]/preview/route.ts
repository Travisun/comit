import { z } from "zod";
import { AppError } from "@/core/errors";
import { withPermission } from "@/lib/permissions";
import { ok, jsonBody } from "@/lib/http";
import {
  MAIL_TEMPLATES,
  SAMPLE_TEMPLATE_DATA,
  getTemplateOverride,
  renderSystemTemplate,
  renderTemplate,
  type MailTemplateOverride,
} from "@/lib/mail-templates";
import { parseOrThrow } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  locale: z.enum(["zh", "en"]).default("zh"),
  /** variable overrides on top of the built-in sample values */
  data: z.record(z.string(), z.string()).optional(),
  /** optional unsaved editor content — preview without saving first */
  subjectZh: z.string().optional(),
  subjectEn: z.string().optional(),
  bodyZh: z.string().optional(),
  bodyEn: z.string().optional(),
});

/**
 * POST /api/admin/templates/[key]/preview — render a template with sample
 * variable values and the saved override (or the fields passed in the body,
 * so unsaved editor content can be previewed). Returns { subject, text }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  return withPermission(req, "admin.templates", async () => {
    const { key } = await params;
    if (!MAIL_TEMPLATES.some((t) => t.key === key)) {
      throw new AppError(`未知模板 / Unknown template: ${key}`, 404, "not_found");
    }
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    // Effective override: explicit fields from the request win, otherwise the
    // saved override (this also refreshes the in-process snapshot).
    const saved = await getTemplateOverride(key);
    const hasExplicit =
      body.subjectZh !== undefined ||
      body.subjectEn !== undefined ||
      body.bodyZh !== undefined ||
      body.bodyEn !== undefined;
    const override: MailTemplateOverride | null = hasExplicit
      ? {
          subjectZh: body.subjectZh ?? "",
          subjectEn: body.subjectEn ?? "",
          bodyZh: body.bodyZh ?? "",
          bodyEn: body.bodyEn ?? "",
          enabled: true,
        }
      : saved;

    const data = { ...SAMPLE_TEMPLATE_DATA[key], ...(body.data ?? {}) };
    const rendered =
      key === "system"
        ? renderSystemTemplate(
            body.locale,
            {
              title: data.title ?? "",
              body: data.body ?? "",
              url: data.url || undefined,
              reason: data.reason || undefined,
            },
            override,
          )
        : renderTemplate(key, body.locale, data, override);

    return ok({ subject: rendered.subject, text: rendered.text });
  });
}
