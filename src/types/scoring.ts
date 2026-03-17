// ═══════════════════════════════════════════════
//  Health Scoring Types
//  Source: design spec §6.6.1
// ═══════════════════════════════════════════════

import type { Department } from "./domain.js";

export type DataMode = "snapshot" | "stream" | "hybrid"; // hybrid = stream DB exists + fresh snapshot supplement

export type Grade = "A" | "B" | "C" | "D" | "F" | "N/A";

export interface HealthScore {
  overall: number;              // 0-100, weighted from evaluable departments only
  overallGrade: Grade;
  dataMode: DataMode;
  coverage: DataCoverage;       // how much of the possible analysis was performed
  departments: Record<Department, DepartmentScore>;
}

export interface DataCoverage {
  evaluableMetrics: number;     // metrics with data
  totalMetrics: number;         // metrics attempted
  ratio: number;                // evaluableMetrics / totalMetrics (0-1)
  skippedDiseases: Array<{      // diseases that couldn't be evaluated
    diseaseId: string;
    reason: "no_data" | "stream_only" | "llm_disabled";
  }>;
}

export interface DepartmentScore {
  score: number | null;         // null = insufficient data to score this department
  grade: Grade;                 // "N/A" when score is null
  weight: number;
  coverage: number;             // 0-1: what fraction of this dept's checks had data
  evaluatedDiseases: number;
  skippedDiseases: number;      // due to missing data
  activeDiseases: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

// ─── Grade mapping (SonarQube style) ───
// A:   90-100  Excellent
// B:   70-89   Good
// C:   50-69   Fair
// D:   25-49   Poor
// F:   0-24    Critical
// N/A: —       Insufficient data

export function scoreToGrade(score: number | null): Grade {
  if (score === null) return "N/A";
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "F";
}
