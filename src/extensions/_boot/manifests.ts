import type { ExtensionManifest, ProfileFieldDef } from "@/core/capabilities/manifest";
import pollManifest from "@/extensions/poll/manifest";
import shareManifest from "@/extensions/share/manifest";
import signatureManifest from "@/extensions/signature/manifest";

/**
 * 内置扩展清单聚合 — 新扩展在此登记 manifest。
 * （第三方扩展体系如需运行时发现，在此改为动态注册即可。）
 */
export const EXTENSION_MANIFESTS: ExtensionManifest[] = [
  signatureManifest,
  shareManifest,
  pollManifest,
];

export function getExtensionManifest(id: string): ExtensionManifest | null {
  return EXTENSION_MANIFESTS.find((m) => m.id === id) ?? null;
}

/** 全部扩展声明的自定义资料字段（资料编辑表单 / 主页「关于」共用）。 */
export function getAllProfileFieldDefs(): ProfileFieldDef[] {
  return EXTENSION_MANIFESTS.flatMap((m) => m.profileFields ?? []);
}

/** 扩展 i18n 词典按语言合并（D10）。 */
export function getAllExtensionI18n(): Record<"zh" | "en", Record<string, string>> {
  const merged: Record<"zh" | "en", Record<string, string>> = { zh: {}, en: {} };
  for (const m of EXTENSION_MANIFESTS) {
    for (const locale of ["zh", "en"] as const) {
      Object.assign(merged[locale], m.i18n?.[locale] ?? {});
    }
  }
  return merged;
}
