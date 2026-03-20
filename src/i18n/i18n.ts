import type { I18nString } from "../types/domain.js";

export function t(str: I18nString, locale: string): string {
  return str[locale] ?? str.en;
}

export function tf(str: I18nString, locale: string, vars: Record<string, string | number>): string {
  let result = t(str, locale);
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(val));
  }
  return result;
}
