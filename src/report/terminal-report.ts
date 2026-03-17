// ═══════════════════════════════════════════════
//  Terminal Health Report Renderer
//  Source: design spec §9.2
//  Uses plain string building (no JSX/Ink) for portability.
// ═══════════════════════════════════════════════

import type { ReportViewModel, DepartmentReportLine } from "./report-data.js";
import { t } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";

// ─── Box drawing constants ────────────────────────────────────────────────────

const BOX_WIDTH = 68; // total inner content width including │ padding
const INNER_WIDTH = 66; // content area (between the two │ chars, minus 2 spaces each side)

function pad(s: string, width: number): string {
  // Pad string with spaces on right to fill width.
  // Note: some box chars are multi-byte; we use simple .length for the ASCII portions.
  return s + " ".repeat(Math.max(0, width - s.length));
}

function boxLine(content: string): string {
  // Wrap a content string in │ ... │ with inner width INNER_WIDTH.
  const padded = pad(content, INNER_WIDTH);
  return `│ ${padded} │`;
}

function blankLine(): string {
  return boxLine("");
}

function separator(): string {
  return "├" + "─".repeat(BOX_WIDTH) + "┤";
}

function topBorder(): string {
  return "┌" + "─".repeat(BOX_WIDTH) + "┐";
}

function bottomBorder(): string {
  return "└" + "─".repeat(BOX_WIDTH) + "┘";
}

// ─── Grade label lookup ───────────────────────────────────────────────────────

function gradeLabelKey(grade: string): keyof typeof UI_STRINGS {
  switch (grade) {
    case "A": return "gradeA";
    case "B": return "gradeB";
    case "C": return "gradeC";
    case "D": return "gradeD";
    case "F": return "gradeF";
    default:  return "gradeNA";
  }
}

// ─── Department section ───────────────────────────────────────────────────────

function renderDepartmentSection(
  dept: DepartmentReportLine,
  locale: string,
): string[] {
  const lines: string[] = [];

  // Score display: "58" or "--" for null
  const scoreStr = dept.score !== null ? String(dept.score) : "--";

  // Line 1: name  score  grade  bar  gradeLabel  [x/y]
  // We build it to match the spec layout
  const gradeLabel = dept.gradeLabel;
  const headerContent =
    `${pad(dept.name, 22)}  ${pad(scoreStr, 3)} ${dept.grade}  ${dept.progressBar}  ${pad(gradeLabel, 11)} ${dept.checksLabel}`;
  lines.push(boxLine(headerContent));

  // Line 2: summary
  lines.push(boxLine(`  ${dept.summary}`));

  // Disease lines
  for (const disease of dept.diseases) {
    lines.push(boxLine(`  > ${disease.id} ${disease.name}: ${disease.description}`));
  }

  // Skipped note
  if (dept.skippedNote) {
    lines.push(boxLine(`  ~ ${dept.skippedNote}`));
  }

  lines.push(blankLine());

  return lines;
}

// ─── Main render function ─────────────────────────────────────────────────────

export function renderReport(viewModel: ReportViewModel, locale: string): string {
  const lines: string[] = [];

  // ─── Top border ───
  lines.push(topBorder());
  lines.push(blankLine());

  // ─── Header ───
  lines.push(boxLine(`  ${t(UI_STRINGS.reportTitle, locale)}`));
  lines.push(boxLine(`  Agent: ${viewModel.agentId} | Data: ${viewModel.dateRange}`));
  lines.push(boxLine(
    `  ${t(UI_STRINGS.mode, locale)}: ${viewModel.dataMode} | ${t(UI_STRINGS.coverage, locale)}: ${viewModel.coveragePercent}% (${viewModel.coverageChecks} checks)`,
  ));
  lines.push(blankLine());

  // ─── Overall health ───
  const overallBar = buildProgressBar(viewModel.overallScore, 10);
  const overallGradeLabel = t(UI_STRINGS[gradeLabelKey(viewModel.overallGrade)], locale);
  lines.push(boxLine(
    `  ${t(UI_STRINGS.overallHealth, locale)}: ${viewModel.overallScore}/100  Grade ${viewModel.overallGrade}  ${overallBar}  ${overallGradeLabel}`,
  ));

  // ─── Partial data warning ───
  if (viewModel.isPartialData) {
    lines.push(boxLine(`  ! ${t(UI_STRINGS.partialDataWarning, locale)}`));
  }

  lines.push(blankLine());

  // ─── Department sections ───
  lines.push(separator());
  lines.push(blankLine());

  for (const dept of viewModel.departments) {
    const deptLines = renderDepartmentSection(dept, locale);
    lines.push(...deptLines);
  }

  // ─── Footer section ───
  lines.push(separator());
  lines.push(blankLine());

  if (viewModel.isPartialData) {
    // Snapshot mode: show skipped count + plugin CTA
    lines.push(boxLine(`  ! ${viewModel.skippedCount} ${t(UI_STRINGS.checksSkipped, locale)}`));
    lines.push(boxLine(`    ${t(UI_STRINGS.installPlugin, locale)}:`));
    lines.push(boxLine(`    npm install clawdoc && openclaw config set plugins.clawdoc…`));
  } else {
    // Stream mode: show quick actions
    lines.push(boxLine(`  ${t(UI_STRINGS.quickActions, locale)}:`));
    lines.push(boxLine(`    clawdoc rx apply --all          Apply all guided Rx`));
    lines.push(boxLine(`    clawdoc rx followup             Check previous Rx results`));
    lines.push(boxLine(`    clawdoc dashboard               Open detailed dashboard`));
  }

  lines.push(blankLine());
  lines.push(bottomBorder());

  return lines.join("\n");
}

// ─── Internal progress bar builder ───────────────────────────────────────────
// (mirrors progress-bar.ts but avoids a circular import in tests)

function buildProgressBar(score: number | null, width: number): string {
  if (score === null) return "─".repeat(width);
  const filled = Math.round((score / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
