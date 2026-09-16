import "server-only";
import { cookies } from "next/headers";
import { translator, type DictKey, type Locale, type Translate } from "./shared";

const COOKIE = "mb_locale";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(COOKIE)?.value;
  return v === "zh" || v === "en" ? v : "zh";
}

/** Server-side translate using the cookie locale. */
export async function getT(): Promise<{
  t: Translate;
  locale: Locale;
  /** 扩展命名空间文案（ext.<id>.<key>，manifest.i18n 声明） */
  tExt: (key: string) => string;
}> {
  const locale = await getLocale();
  const { getAllExtensionI18n } = await import("@/extensions/_boot/manifests");
  const dicts = getAllExtensionI18n();
  const tExt = (key: string) => dicts[locale]?.[key] ?? dicts.zh?.[key] ?? key;
  return { t: translator(locale), locale, tExt };
}

export { translator, isLocale, LOCALES, DEFAULT_LOCALE } from "./shared";
export type { Locale, Translate, DictKey };
