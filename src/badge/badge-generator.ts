// ═══════════════════════════════════════════════
//  Badge Generator
//  Generates shields.io-style SVG badges for
//  Skill Quality scores.
//  Design spec: Phase 3, Task 1
// ═══════════════════════════════════════════════

export interface BadgeOptions {
  grade: string;   // "A", "B", "C", "D", "F", "N/A"
  score: number;
  label?: string;  // default "ClawDoctor"
}

// XML entity escaping to prevent SVG injection
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ─── Grade → badge color ───

const GRADE_COLORS: Record<string, string> = {
  "A":   "#4c1",
  "B":   "#97CA00",
  "C":   "#dfb317",
  "D":   "#fe7d37",
  "F":   "#e05d44",
  "N/A": "#9f9f9f",
};

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? GRADE_COLORS["N/A"];
}

// ─── Approximate text width (Verdana 11px) ───
// Shields.io uses a ~6.5px average character width for Verdana 11.

function textWidth(text: string): number {
  return Math.round(text.length * 6.5 + 10);
}

// ─── generateBadge ───

/**
 * Returns a shields.io-compatible flat-style SVG badge string.
 *
 * Layout (two-panel, rounded rect, 20px height):
 *   [ label ][ grade score ]
 *
 * Colors: label panel is #555, value panel is grade-dependent.
 */
export function generateBadge(opts: BadgeOptions): string {
  const label = escapeXml(opts.label ?? "ClawDoctor");
  const grade = opts.grade;
  const score = opts.score;

  // Value text: e.g. "A 95" or "N/A"
  const valueText = grade === "N/A" ? "N/A" : `${grade} ${Math.round(score)}`;

  const color = gradeColor(grade);

  const labelW = textWidth(label);
  const valueW = textWidth(valueText);
  const totalW = labelW + valueW;
  const height = 20;

  // Text vertical center
  const textY = 14;
  // Label text x (centered in label panel)
  const labelX = Math.round(labelW / 2) + 1;
  // Value text x (centered in value panel)
  const valueX = labelW + Math.round(valueW / 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="${height}" role="img" aria-label="${label}: ${valueText}">
  <title>${label}: ${valueText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${height}" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="${height}" fill="${color}"/>
    <rect width="${totalW}" height="${height}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="${labelX * 10}" y="${(textY - 1) * 10}" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${labelX * 10}" y="${textY * 10}" transform="scale(.1)" textLength="${(labelW - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${valueX * 10}" y="${(textY - 1) * 10}" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueW - 10) * 10}" lengthAdjust="spacing">${valueText}</text>
    <text x="${valueX * 10}" y="${textY * 10}" transform="scale(.1)" textLength="${(valueW - 10) * 10}" lengthAdjust="spacing">${valueText}</text>
  </g>
</svg>`;

  return svg;
}
