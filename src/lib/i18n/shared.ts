import { zh, en, type DictKey } from "./dict";

/** Pure (client-safe) i18n core — no server-only imports. */
export type Locale = "zh" | "en";
export const LOCALES: Locale[] = ["zh", "en"];
export const DEFAULT_LOCALE: Locale = "zh";

export type Translate = (key: DictKey, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dict = locale === "en" ? en : zh;
  return (key, vars) => {
    let s: string = dict[key] ?? zh[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function isLocale(v: string | undefined): v is Locale {
  return v === "zh" || v === "en";
}

export type { DictKey };
