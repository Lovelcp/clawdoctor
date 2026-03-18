import { describe, it, expect } from "vitest";
import { summarizeParams, summarizeResult, redactAndTruncate } from "./summarize.js";

// ─── summarizeParams ───────────────────────────────────────────────────────────

describe("summarizeParams", () => {
  it("maps primitive types to their type descriptor", () => {
    const result = summarizeParams({
      query: "hello",
      limit: 10,
      enabled: true,
    });
    expect(result).toEqual({
      query: "string",
      limit: "number",
      enabled: "boolean",
    });
  });

  it("maps null value to 'null'", () => {
    const result = summarizeParams({ cursor: null });
    expect(result).toEqual({ cursor: "null" });
  });

  it("maps undefined value to 'undefined'", () => {
    const result = summarizeParams({ cursor: undefined });
    expect(result).toEqual({ cursor: "undefined" });
  });

  it("maps arrays to 'array[N]' with correct item count", () => {
    const result = summarizeParams({
      items: [1, 2, 3],
      empty: [],
      nested: [[1], [2]],
    });
    expect(result).toEqual({
      items: "array[3]",
      empty: "array[0]",
      nested: "array[2]",
    });
  });

  it("maps plain objects to 'object'", () => {
    const result = summarizeParams({ config: { key: "value" }, meta: {} });
    expect(result).toEqual({ config: "object", meta: "object" });
  });

  it("does not leak raw param values into the summary", () => {
    const result = summarizeParams({ apiKey: "sk-secret-value", path: "/home/user/file.txt" });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("sk-secret-value");
    expect(serialised).not.toContain("/home/user/file.txt");
  });

  it("returns an empty object for an empty params record", () => {
    expect(summarizeParams({})).toEqual({});
  });
});

// ─── summarizeResult ──────────────────────────────────────────────────────────

describe("summarizeResult", () => {
  it("returns undefined for undefined input", () => {
    expect(summarizeResult(undefined)).toBeUndefined();
  });

  it("returns { type: 'null' } for null", () => {
    expect(summarizeResult(null)).toEqual({ type: "null" });
  });

  it("returns { type: 'string', length } for a string", () => {
    const s = "hello world";
    expect(summarizeResult(s)).toEqual({ type: "string", length: s.length });
  });

  it("returns { type: 'string', length: 0 } for an empty string", () => {
    expect(summarizeResult("")).toEqual({ type: "string", length: 0 });
  });

  it("returns { type: 'object', length } for a plain object", () => {
    const obj = { a: 1, b: "two" };
    const expected = { type: "object", length: JSON.stringify(obj).length };
    expect(summarizeResult(obj)).toEqual(expected);
  });

  it("returns { type: 'object', length } for a nested object", () => {
    const obj = { outer: { inner: [1, 2, 3] } };
    expect(summarizeResult(obj)).toEqual({
      type: "object",
      length: JSON.stringify(obj).length,
    });
  });

  it("returns { type: 'object', length } for an array (arrays are objects)", () => {
    const arr = [1, 2, 3];
    expect(summarizeResult(arr)).toEqual({
      type: "object",
      length: JSON.stringify(arr).length,
    });
  });

  it("does not include raw content in the summary", () => {
    const sensitive = { secret: "do-not-store-me" };
    const result = summarizeResult(sensitive);
    expect(JSON.stringify(result)).not.toContain("do-not-store-me");
  });
});

// ─── redactAndTruncate ────────────────────────────────────────────────────────

describe("redactAndTruncate", () => {
  it("returns undefined for undefined input", () => {
    expect(redactAndTruncate(undefined, 100)).toBeUndefined();
  });

  it("truncates a string to maxLength", () => {
    const result = redactAndTruncate("abcdefghij", 5);
    expect(result).toBe("abcde");
    expect(result!.length).toBe(5);
  });

  it("does not truncate when string is shorter than maxLength", () => {
    const result = redactAndTruncate("hello", 100);
    expect(result).toBe("hello");
  });

  it("returns empty string when maxLength is 0", () => {
    expect(redactAndTruncate("hello", 0)).toBe("");
  });

  it("redacts an Anthropic API key (sk-ant-api03- prefix)", () => {
    const key = "sk-ant-api03-AAAA12345678BBBB";
    const result = redactAndTruncate(`token: ${key}`, 200);
    expect(result).toBeDefined();
    expect(result).not.toContain("12345678");
    expect(result).toContain("***");
    expect(result).toContain("sk-ant-api03-");
  });

  it("redacts a generic sk- API key (16+ chars after prefix)", () => {
    const key = "sk-AAAA1234567890BBBB";
    const result = redactAndTruncate(`Authorization: Bearer ${key}`, 200);
    expect(result).toBeDefined();
    expect(result).not.toContain("1234567890");
    expect(result).toContain("***");
    expect(result).toContain("sk-");
  });

  it("redacts multiple keys in one string", () => {
    const input = "first: sk-AAAA1234567890BBBB second: sk-CCCC0987654321DDDD";
    const result = redactAndTruncate(input, 500)!;
    expect(result).not.toContain("1234567890");
    expect(result).not.toContain("0987654321");
    expect(result.match(/\*\*\*/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("truncates before redacting so result length never exceeds maxLength", () => {
    const key = "sk-AAAA1234567890BBBB";
    const input = `prefix ${key} suffix`;
    const result = redactAndTruncate(input, 20)!;
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("leaves strings without API keys unchanged (except truncation)", () => {
    const input = "No secrets here, just plain text.";
    expect(redactAndTruncate(input, 200)).toBe(input);
  });
});
