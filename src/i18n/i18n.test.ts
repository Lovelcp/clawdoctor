import { describe, it, expect } from "vitest";
import { t, tf } from "./i18n.js";
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

describe("tf()", () => {
  it("interpolates variables into translated string", () => {
    const s: I18nString = { en: "Found {count} issues", zh: "发现 {count} 个问题" };
    expect(tf(s, "en", { count: 3 })).toBe("Found 3 issues");
    expect(tf(s, "zh", { count: 3 })).toBe("发现 3 个问题");
  });

  it("replaces all occurrences of the same placeholder", () => {
    const s: I18nString = { en: "{n} of {n} done", zh: "{n}/{n} 完成" };
    expect(tf(s, "en", { n: 5 })).toBe("5 of 5 done");
  });

  it("leaves unreplaced placeholders as-is", () => {
    const s: I18nString = { en: "Hello {name}, age {age}" };
    expect(tf(s, "en", { name: "Bob" })).toBe("Hello Bob, age {age}");
  });

  it("falls back to en for unknown locale", () => {
    const s: I18nString = { en: "Score: {score}" };
    expect(tf(s, "ja", { score: 85 })).toBe("Score: 85");
  });
});
