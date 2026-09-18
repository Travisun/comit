import { ok, withAdmin } from "@/lib/http";
import { AppError } from "@/core/errors";
import { logAdmin } from "@/app/api/admin/_shared";
import { mailConfig, sendMail } from "@/lib/mail";
import { renderMail } from "@/lib/mail";
import type { Locale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/settings/test-mail — 用当前生效的 SMTP 配置（DB 优先 /
 * env 兜底）给管理员自己的邮箱发一封测试邮件，验证发信链路。
 */
export async function POST(req: Request) {
  return withAdmin(req, async ({ user }) => {
    const cfg = await mailConfig();
    if (!cfg.enabled) {
      throw new AppError(
        "尚未配置 SMTP 主机（后台或环境变量至少其一） / SMTP host not configured",
        400,
        "smtp_not_configured",
      );
    }
    const locale = (user.locale === "en" ? "en" : "zh") as Locale;
    const mail = renderMail("test", locale, {});
    await sendMail({ to: user.email, ...mail });
    await logAdmin(user.id, "settings.test-mail", "settings", null, `to=${user.email}`);
    return ok({ message: `测试邮件已发送至 ${user.email}，请查收（含垃圾箱）` });
  });
}
