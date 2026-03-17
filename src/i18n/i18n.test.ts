import { describe, it, expect } from "vitest";
import { t } from "./i18n.js";
import type { I18nString } from "../types/domain.js";

describe("t()", () => {
  it("returns the value for the requested locale", () => {
    const s: I18nString = { en: "Hello", zh: "你好" };
    expect(t(s, "zh")).toBe("你好");
  });

  it("falls back to en when locale is missing", () => {
    const s: I18nString = { en: "Hello" };
    expect(t(s, "zh")).toBe("Hello");
  });

  it("returns en for locale 'en'", () => {
    const s: I18nString = { en: "Hello", zh: "你好" };
    expect(t(s, "en")).toBe("Hello");
  });

  it("falls back to en for unknown locale", () => {
    const s: I18nString = { en: "Hello", zh: "你好" };
    expect(t(s, "ja")).toBe("Hello");
  });

  it("returns specific locale when multiple locales exist", () => {
    const s: I18nString = { en: "Good", zh: "良好", ja: "良い" };
    expect(t(s, "ja")).toBe("良い");
  });
});
