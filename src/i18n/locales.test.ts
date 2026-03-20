import { describe, it, expect } from "vitest";
import { UI_STRINGS } from "./locales.js";

describe("UI_STRINGS completeness", () => {
  const entries = Object.entries(UI_STRINGS);

  it("has at least 50 keys", () => {
    expect(entries.length).toBeGreaterThanOrEqual(50);
  });

  for (const [key, value] of entries) {
    it(`"${key}" has non-empty en and zh`, () => {
      expect(typeof value.en).toBe("string");
      expect(value.en.length).toBeGreaterThan(0);
      expect(typeof value.zh).toBe("string");
      expect(value.zh.length).toBeGreaterThan(0);
    });
  }

  it("template placeholders are consistent between en and zh", () => {
    const placeholderRe = /\{(\w+)\}/g;
    for (const [key, value] of entries) {
      const enPlaceholders = [...value.en.matchAll(placeholderRe)].map((m) => m[1]).sort();
      const zhPlaceholders = [...value.zh.matchAll(placeholderRe)].map((m) => m[1]).sort();
      expect(enPlaceholders, `Placeholder mismatch in "${key}"`).toEqual(zhPlaceholders);
    }
  });
});
