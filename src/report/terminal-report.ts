// ═══════════════════════════════════════════════
//  Terminal Health Report Renderer v2
//  Clean, colored, medical-monitor aesthetic
// ═══════════════════════════════════════════════

import type { ReportViewModel, DepartmentReportLine } from "./report-data.js";
import { t } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";
import { style, color, colorForGrade, colorForSeverity, coloredBar, padEnd } from "./ansi.js";

// ─── Constants ───────────────────────────────

const SEVERITY_ICON: Record<string, string> = {
  critical: "●",
  warning: "▲",
  info: "○",
};

function gradeEmoji(grade: string): string {
  switch (grade) {
    case "A": return "✦";
    case "B": return "◆";
    case "C": return "◇";
    case "D": return "▽";
    case "F": return "✖";
    default: return "─";
  }
}

// ─── Grade label lookup ──────────────────────

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

// ─── Section builders ────────────────────────

function renderHeader(vm: ReportViewModel, locale: string): string[] {
  const lines: string[] = [];

  // Branded title
  lines.push("");
  lines.push(
    `  ${color.lobster("🦞")} ${style.bold(color.lobster(t(UI_STRINGS.reportTitle, locale)))}`,
  );
  lines.push(
    `  ${color.muted("Agent:")} ${color.white(vm.agentId)}  ${color.muted("│")}  ${color.muted(vm.dateRange)}`,
  );
  lines.push(
    `  ${color.muted(t(UI_STRINGS.mode, locale) + ":")} ${color.accent(vm.dataMode)}  ${color.muted("│")}  ${color.muted(t(UI_STRINGS.coverage, locale) + ":")} ${coverageColor(vm.coveragePercent)(`${vm.coveragePercent}%`)} ${color.subtle(`(${vm.coverageChecks})`)}`,
  );
  lines.push("");

  return lines;
}

function coverageColor(pct: number): (s: string) => string {
  if (pct >= 90) return color.healthy;
  if (pct >= 60) return color.warning;
  return color.critical;
}

function renderOverallScore(vm: ReportViewModel, locale: string): string[] {
  const lines: string[] = [];
  const gc = colorForGrade(vm.overallGrade);
  const gradeLabel = t(UI_STRINGS[gradeLabelKey(vm.overallGrade)], locale);

  lines.push(
    `  ${color.label(t(UI_STRINGS.overallHealth, locale))}`,
  );
  lines.push("");
  lines.push(
    `  ${gc(style.bold(`${vm.overallScore}`))}${color.muted("/100")}  ${gc(style.bold(vm.overallGrade))} ${gc(gradeEmoji(vm.overallGrade))} ${gc(gradeLabel)}  ${coloredBar(vm.overallScore, 20)}`,
  );

  if (vm.isPartialData) {
    lines.push(
      `  ${color.warning("⚠")} ${color.warning(t(UI_STRINGS.partialDataWarning, locale))}`,
    );
  }

  lines.push("");

  return lines;
}

function renderDivider(): string {
  return `  ${color.subtle("─".repeat(60))}`;
}

function renderDepartment(dept: DepartmentReportLine, locale: string): string[] {
  const lines: string[] = [];
  const gc = colorForGrade(dept.grade);

  // Score line
  const scoreStr = dept.score !== null
    ? gc(style.bold(String(dept.score).padStart(3)))
    : color.gradeNA(" --");

  const gradeStr = dept.score !== null
    ? gc(style.bold(dept.grade))
    : color.gradeNA("N/A");

  lines.push(
    `  ${padEnd(color.white(dept.name), 30)}  ${scoreStr}  ${gradeStr}  ${coloredBar(dept.score, 12)}  ${color.subtle(dept.checksLabel)}`,
  );

  // Summary
  lines.push(
    `  ${color.muted(dept.summary)}`,
  );

  // Diseases
  for (const disease of dept.diseases) {
    const sc = colorForSeverity(disease.severity);
    const icon = SEVERITY_ICON[disease.severity] ?? "·";
    lines.push(
      `    ${sc(icon)} ${sc(disease.id)} ${color.label(disease.name)} ${color.muted("— " + disease.description)}`,
    );
  }

  // Skipped note
  if (dept.skippedNote) {
    lines.push(
      `    ${color.subtle("~ " + dept.skippedNote)}`,
    );
  }

  lines.push("");

  return lines;
}

function renderFooter(vm: ReportViewModel, locale: string): string[] {
  const lines: string[] = [];

  lines.push(renderDivider());
  lines.push("");

  if (vm.isPartialData) {
    lines.push(
      `  ${color.warning("!")} ${color.warning(`${vm.skippedCount} ${t(UI_STRINGS.checksSkipped, locale)}`)}`,
    );
    lines.push(
      `  ${color.muted(t(UI_STRINGS.installPlugin, locale) + ":")}`,
    );
    lines.push(
      `  ${color.accent("npm install clawdoctor")} ${color.muted("&&")} ${color.accent("openclaw config set plugins.clawdoctor enabled")}`,
    );
  } else {
    lines.push(
      `  ${color.label(t(UI_STRINGS.quickActions, locale))}`,
    );
    lines.push("");
    lines.push(
      `  ${color.accent("clawdoctor rx apply --all")}          ${color.muted("Apply all guided Rx")}`,
    );
    lines.push(
      `  ${color.accent("clawdoctor rx followup")}             ${color.muted("Check previous Rx results")}`,
    );
    lines.push(
      `  ${color.accent("clawdoctor dashboard")}               ${color.muted("Open detailed dashboard")}`,
    );
  }

  lines.push("");

  return lines;
}

// ─── Main render function ────────────────────

export function renderReport(viewModel: ReportViewModel, locale: string): string {
  const lines: string[] = [];

  lines.push(...renderHeader(viewModel, locale));
  lines.push(...renderOverallScore(viewModel, locale));
  lines.push(renderDivider());
  lines.push("");

  for (const dept of viewModel.departments) {
    lines.push(...renderDepartment(dept, locale));
  }

  lines.push(...renderFooter(viewModel, locale));

  return lines.join("\n");
}
