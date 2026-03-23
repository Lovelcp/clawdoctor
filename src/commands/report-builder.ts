// ═══════════════════════════════════════════════
//  Report ViewModel Builder
//  Converts CheckupResult → ReportViewModel
//  for use by the terminal renderer.
// ═══════════════════════════════════════════════

import { getDiseaseRegistry } from "../diseases/registry.js";
import { progressBar } from "../report/progress-bar.js";
import { t, tf } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";
import type { CheckupResult } from "../analysis/analysis-pipeline.js";
import type { Department } from "../types/domain.js";
import type { ReportViewModel, DepartmentReportLine, DiseaseReportLine } from "../report/report-data.js";

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

// ─── All departments in display order ────────────────────────────────────────

const ALL_DEPARTMENTS: Department[] = ["vitals", "skill", "memory", "behavior", "cost", "security", "infra"];

// ─── buildReportViewModel ─────────────────────────────────────────────────────

export function buildReportViewModel(
  result: CheckupResult,
  agentId: string,
  dateRange: string,
  filteredDepts?: Department[],
  locale = "en",
): ReportViewModel {
  const registry = getDiseaseRegistry();
  const { healthScore, diseases } = result;

  // Determine which departments to render
  const deptsToRender = filteredDepts ?? ALL_DEPARTMENTS;

  // Build per-department lines
  const departmentLines: DepartmentReportLine[] = deptsToRender.map((dept) => {
    const deptScore = healthScore.departments[dept];

    // Localized department name
    const nameKey = dept as keyof typeof UI_STRINGS;
    const name = (UI_STRINGS[nameKey] && typeof UI_STRINGS[nameKey] === "object")
      ? t(UI_STRINGS[nameKey] as { en: string; [k: string]: string }, locale)
      : dept;

    // Diseases that belong to this department
    const deptDiseases = diseases.filter((d) => {
      const def = registry.getById(d.definitionId);
      return def?.department === dept;
    });

    const diseaseLines: DiseaseReportLine[] = deptDiseases.map((d) => {
      const def = registry.getById(d.definitionId);
      const diseaseName = def ? t(def.name, locale) : d.definitionId;
      const diseaseDesc = def ? t(def.description, locale) : "";
      return {
        id: d.definitionId,
        name: diseaseName,
        description: diseaseDesc,
        severity: d.severity,
      };
    });

    const score = deptScore?.score ?? null;
    const grade = deptScore?.grade ?? "N/A";
    const gradeLabel = t(UI_STRINGS[gradeLabelKey(grade)], locale);
    const bar = progressBar(score, 10);

    // Build checks label "[evaluable/total]"
    const evalDiseases = deptScore?.evaluatedDiseases ?? 0;
    const skippedDiseases = deptScore?.skippedDiseases ?? 0;
    const totalChecks = evalDiseases + skippedDiseases;
    const checksLabel = `[${evalDiseases}/${totalChecks}]`;

    // Build summary line
    let summary: string;
    if (score === null) {
      const coveragePct = deptScore ? Math.round(deptScore.coverage * 100) : 0;
      summary = tf(UI_STRINGS["report.insufficientData"], locale, { coverage: coveragePct });
    } else {
      const activeDiseases = deptScore?.activeDiseases ?? 0;
      const criticals = deptScore?.criticalCount ?? 0;
      const warnings = deptScore?.warningCount ?? 0;
      const scoreRounded = Math.round(score);
      summary = tf(UI_STRINGS["report.scoreSummary"], locale, { score: scoreRounded, count: activeDiseases, critical: criticals, warning: warnings });
    }

    // Skipped note if any checks were skipped
    let skippedNote: string | undefined;
    if (skippedDiseases > 0) {
      skippedNote = tf(UI_STRINGS["report.deptChecksSkipped"], locale, { count: skippedDiseases, dept: name });
    }

    return {
      name,
      score: score !== null ? Math.round(score) : null,
      grade,
      gradeLabel,
      progressBar: bar,
      checksLabel,
      summary,
      diseases: diseaseLines,
      skippedNote,
    };
  });

  // Aggregate all disease lines for the top-level list
  const allDiseaseLines: DiseaseReportLine[] = diseases.map((d) => {
    const def = registry.getById(d.definitionId);
    return {
      id: d.definitionId,
      name: def ? t(def.name, locale) : d.definitionId,
      description: def ? t(def.description, locale) : "",
      severity: d.severity,
    };
  });

  // Coverage
  const coverage = healthScore.coverage;
  const coveragePercent = Math.round(coverage.ratio * 100);
  const coverageChecks = `${coverage.evaluableMetrics}/${coverage.totalMetrics}`;

  // Skipped count
  const skippedCount = coverage.skippedDiseases.length;

  return {
    agentId,
    dateRange,
    dataMode: healthScore.dataMode,
    coveragePercent,
    coverageChecks,
    overallScore: Math.round(healthScore.overall),
    overallGrade: healthScore.overallGrade,
    departments: departmentLines,
    diseases: allDiseaseLines,
    skippedCount,
    isPartialData: healthScore.dataMode === "snapshot",
  };
}
