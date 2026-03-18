// ═══════════════════════════════════════════════
//  Event Summarizer Utilities
//  Source: design spec §Phase 2 – privacy-safe storage
// ═══════════════════════════════════════════════

/**
 * Convert each value in a params record to a type descriptor string.
 * Arrays are described as "array[N]" where N is the item count.
 * Objects (non-null, non-array) are described as "object".
 * All other types use typeof.
 */
export function summarizeParams(params: Record<string, unknown>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      summary[key] = "null";
    } else if (value === undefined) {
      summary[key] = "undefined";
    } else if (Array.isArray(value)) {
      summary[key] = `array[${value.length}]`;
    } else if (typeof value === "object") {
      summary[key] = "object";
    } else {
      summary[key] = typeof value;
    }
  }
  return summary;
}

/**
 * Produce a type + length summary of a tool result.
 * Returns undefined for undefined input (no result yet / not applicable).
 * Does NOT store the raw result value.
 */
export function summarizeResult(
  result: unknown
): { type: string; length?: number } | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (result === null) {
    return { type: "null" };
  }
  if (typeof result === "string") {
    return { type: "string", length: result.length };
  }
  if (typeof result === "object") {
    return { type: "object", length: JSON.stringify(result).length };
  }
  return { type: typeof result };
}

// Patterns for API key redaction (most-specific first so sk-ant-api03 is tried before sk-).
const REDACT_PATTERNS: RegExp[] = [
  // Anthropic long-form key: sk-ant-api03-<16+ chars>
  /sk-ant-api03-([A-Za-z0-9_\-]{4})[A-Za-z0-9_\-]{8,}([A-Za-z0-9_\-]{4})/g,
  // Generic sk- key with 16+ chars after prefix
  /sk-([A-Za-z0-9_\-]{4})[A-Za-z0-9_\-]{8,}([A-Za-z0-9_\-]{4})/g,
];

/**
 * Truncate a string to maxLength characters and redact known API key patterns.
 * Returns undefined for undefined input.
 * Truncation is applied before redaction so the result is always ≤ maxLength chars
 * (redaction can only shorten or keep the same length).
 */
export function redactAndTruncate(
  input: string | undefined,
  maxLength: number
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  let result = input.slice(0, maxLength);

  for (const pattern of REDACT_PATTERNS) {
    // Reset lastIndex because we reuse the same RegExp objects across calls.
    pattern.lastIndex = 0;
    result = result.replace(pattern, (_, prefix: string, suffix: string) => {
      const matchedPrefix = _.startsWith("sk-ant-api03-") ? "sk-ant-api03-" : "sk-";
      return `${matchedPrefix}${prefix}***${suffix}`;
    });
  }

  return result;
}
