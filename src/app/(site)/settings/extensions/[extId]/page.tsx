import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n";
import { coerceExtSettings } from "@/core/capabilities/manifest";
import { getExtensionManifest } from "@/extensions/_boot/manifests";
import { TimelineHeader } from "@/components/site-shell";
import { SettingsSection, SettingsSectionHeader } from "@/components/ui/settings";
import { ExtensionSettingsForm } from "@/components/settings/extension-settings-form";

export const dynamic = "force-dynamic";

/**
 * 扩展子设置页（三级架构第三层）：设置 → 扩展（列表）→ 扩展设置（表单）。
 * 仅接受注册了前台设置项的扩展；其余（纯后台能力扩展）一律 404。
 * 数据经 /api/me/ext/<id>/settings 读写 —— 用户级、按用户行隔离，
 * 服务端按 manifest 白名单收敛（未声明键不可写入）。
 */
export default async function ExtensionSettingsPage({
  params,
}: {
  params: Promise<{ extId: string }>;
}) {
  const { extId } = await params;
  const auth = await requireUser();
  const manifest = getExtensionManifest(extId);
  if (!manifest || (manifest.settingsFields?.length ?? 0) === 0) notFound();

  const { locale } = await getT();
  const zh = locale === "zh";

  const [row] = await db
    .select({ extSettings: users.extSettings })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);
  const raw = (row?.extSettings as Record<string, Record<string, unknown>> | null)?.[extId];
  const initial = coerceExtSettings(manifest, raw);

  return (
    <div className="w-full pt-[10px]">
      <TimelineHeader back title={manifest.title.zh} />
      <div className="mx-auto w-full max-w-[600px] pb-10">
        <SettingsSection>
          {/* 标题即页面标题（TimelineHeader），正文不再重复扩展名 */}
          <SettingsSectionHeader
            description={
              manifest.description
                ? zh
                  ? manifest.description.zh
                  : manifest.description.en
                : `${manifest.id} · v${manifest.version}`
            }
          />
          <ExtensionSettingsForm
            id={manifest.id}
            fields={manifest.settingsFields ?? []}
            initial={initial}
          />
        </SettingsSection>
      </div>
    </div>
  );
}
