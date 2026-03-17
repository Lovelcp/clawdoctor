// ═══════════════════════════════════════════════
//  Report View Model
//  Source: design spec §9.2
// ═══════════════════════════════════════════════

import type { Grade, DataMode } from "../types/scoring.js";
import type { Severity } from "../types/domain.js";

export interface ReportViewModel {
  agentId: string;
  dateRange: string;
  dataMode: DataMode;
  coveragePercent: number;
  coverageChecks: string;   // e.g. "27/43"
  overallScore: number;
  overallGrade: Grade;
  departments: DepartmentReportLine[];
  diseases: DiseaseReportLine[];
  skippedCount: number;
  isPartialData: boolean;   // true if dataMode === "snapshot"
}

export interface DepartmentReportLine {
  name: string;             // localized department name
  score: number | null;
  grade: string;            // "A", "B", ..., "N/A"
  gradeLabel: string;       // "Excellent", "Good", ...
  progressBar: string;      // "████████░░"
  checksLabel: string;      // "[5/10]"
  summary: string;          // e.g. "14 tools tracked | 3 need attention"
  diseases: DiseaseReportLine[];
  skippedNote?: string;     // e.g. "5 checks skipped (need plugin...)"
}

export interface DiseaseReportLine {
  id: string;
  name: string;             // localized
  description: string;      // brief context
  severity: Severity;
}
