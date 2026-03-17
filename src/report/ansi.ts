// ═══════════════════════════════════════════════
//  ANSI escape code helpers for terminal styling
// ═══════════════════════════════════════════════

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

// ─── Basic styles ────────────────────────────

export const style = {
  reset: RESET,
  bold: (s: string) => `${ESC}1m${s}${RESET}`,
  dim: (s: string) => `${ESC}2m${s}${RESET}`,
  italic: (s: string) => `${ESC}3m${s}${RESET}`,
  underline: (s: string) => `${ESC}4m${s}${RESET}`,
  strikethrough: (s: string) => `${ESC}9m${s}${RESET}`,
};

// ─── 256-color palette ───────────────────────

function fg256(code: number, s: string): string {
  return `${ESC}38;5;${code}m${s}${RESET}`;
}

function bg256(code: number, s: string): string {
  return `${ESC}48;5;${code}m${s}${RESET}`;
}

// ─── Semantic colors ─────────────────────────

export const color = {
  // Brand
  lobster: (s: string) => fg256(209, s),      // warm coral-orange
  lobsterBg: (s: string) => bg256(209, fg256(232, s)),

  // Severity
  critical: (s: string) => fg256(196, s),      // vivid red
  warning: (s: string) => fg256(214, s),       // amber
  info: (s: string) => fg256(75, s),           // soft blue
  healthy: (s: string) => fg256(78, s),        // spring green

  // Grades
  gradeA: (s: string) => fg256(78, s),         // green
  gradeB: (s: string) => fg256(114, s),        // light green
  gradeC: (s: string) => fg256(214, s),        // amber
  gradeD: (s: string) => fg256(208, s),        // orange
  gradeF: (s: string) => fg256(196, s),        // red
  gradeNA: (s: string) => fg256(240, s),       // dim gray

  // Structural
  muted: (s: string) => fg256(244, s),         // medium gray
  subtle: (s: string) => fg256(239, s),        // dark gray
  accent: (s: string) => fg256(117, s),        // teal
  white: (s: string) => fg256(255, s),         // bright white
  label: (s: string) => fg256(250, s),         // light gray
};

// ─── Grade → color mapper ────────────────────

export function colorForGrade(grade: string): (s: string) => string {
  switch (grade) {
    case "A": return color.gradeA;
    case "B": return color.gradeB;
    case "C": return color.gradeC;
    case "D": return color.gradeD;
    case "F": return color.gradeF;
    default: return color.gradeNA;
  }
}

export function colorForSeverity(severity: string): (s: string) => string {
  switch (severity) {
    case "critical": return color.critical;
    case "warning": return color.warning;
    case "info": return color.info;
    default: return color.muted;
  }
}

// ─── Colored progress bar ────────────────────

export function coloredBar(score: number | null, width: number = 12): string {
  if (score === null) return color.subtle("·".repeat(width));

  const filled = Math.round((score / 100) * width);
  const empty = width - filled;

  const barColor =
    score >= 90 ? color.gradeA :
    score >= 70 ? color.gradeB :
    score >= 50 ? color.gradeC :
    score >= 25 ? color.gradeD :
    color.gradeF;

  return barColor("━".repeat(filled)) + color.subtle("─".repeat(empty));
}

// ─── Strip ANSI (for testing / length calc) ──

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── Visual width (ignoring ANSI codes) ──────

export function visualWidth(s: string): string {
  return stripAnsi(s);
}

export function padEnd(s: string, width: number): string {
  const current = stripAnsi(s).length;
  if (current >= width) return s;
  return s + " ".repeat(width - current);
}
