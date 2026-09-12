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
export async function getT(): Promise<{ t: Translate; locale: Locale }> {
  const locale = await getLocale();
  return { t: translator(locale), locale };
}

export { translator, isLocale, LOCALES, DEFAULT_LOCALE } from "./shared";
export type { Locale, Translate, DictKey };
