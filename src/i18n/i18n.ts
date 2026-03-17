import type { I18nString } from "../types/domain.js";

export function t(str: I18nString, locale: string): string {
  return str[locale] ?? str.en;
}
