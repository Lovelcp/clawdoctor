import { describe, it, expect } from "vitest";
import { renderReport } from "./terminal-report.js";
import { stripAnsi } from "./ansi.js";
import type { ReportViewModel } from "./report-data.js";
import type { DepartmentReportLine, DiseaseReportLine } from "./report-data.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const sampleDisease: DiseaseReportLine = {
  id: "SK-002",
  name: "Scenario Paralysis",
  description: "web_search: success 45%",
  severity: "warning",
};

const criticalDisease: DiseaseReportLine = {
  id: "CST-001",
  name: "Token Overflow",
  description: "Daily token usage exceeds warning threshold",
  severity: "critical",
};

const skillDept: DepartmentReportLine = {
  name: "Skill & Tool",
  score: 58,
  grade: "C",
  gradeLabel: "Fair",
  progressBar: "██████░░░░",
  checksLabel: "[10/10]",
  summary: "14 tools tracked | 3 need attention",
  diseases: [sampleDisease],
};

const behaviorDeptNA: DepartmentReportLine = {
  name: "Agent Behavior",
  score: null,
  grade: "N/A",
  gradeLabel: "Insufficient data",
  progressBar: "──────────",
  checksLabel: "[2/7]",
  summary: "Insufficient data for scoring (40% coverage)",
  diseases: [],
  skippedNote: "5 checks skipped (need plugin for behavioral analysis)",
};

const streamViewModel: ReportViewModel = {
  agentId: "default",
  dateRange: "2026-03-10 ~ 2026-03-17",
  dataMode: "stream",
  coveragePercent: 100,
  coverageChecks: "43/43",
  overallScore: 61,
  overallGrade: "C",
  departments: [skillDept],
  diseases: [sampleDisease],
  skippedCount: 0,
  isPartialData: false,
};

const snapshotViewModel: ReportViewModel = {
  agentId: "default",
  dateRange: "2026-03-10 ~ 2026-03-17",
  dataMode: "snapshot",
  coveragePercent: 63,
  coverageChecks: "27/43",
  overallScore: 72,
  overallGrade: "B",
  departments: [skillDept, behaviorDeptNA],
  diseases: [sampleDisease],
  skippedCount: 16,
  isPartialData: true,
};

// Helper: strip ANSI for content assertions
function plain(vm: ReportViewModel, locale = "en"): string {
  return stripAnsi(renderReport(vm, locale));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("renderReport — stream mode", () => {
  it("contains the report title", () => {
    expect(plain(streamViewModel)).toContain("ClawDoc Health Report");
  });

  it("shows agent ID in header", () => {
    expect(plain(streamViewModel)).toContain("Agent:");
    expect(plain(streamViewModel)).toContain("default");
  });

  it("shows date range in header", () => {
    expect(plain(streamViewModel)).toContain("2026-03-10 ~ 2026-03-17");
  });

  it("shows mode: stream in header", () => {
    const text = plain(streamViewModel);
    expect(text).toContain("Mode:");
    expect(text).toContain("stream");
  });

  it("shows coverage in header", () => {
    const text = plain(streamViewModel);
    expect(text).toContain("Coverage:");
    expect(text).toContain("100%");
    expect(text).toContain("43/43");
  });

  it("shows overall health line with score and grade", () => {
    const text = plain(streamViewModel);
    expect(text).toContain("Overall Health");
    expect(text).toContain("61");
    expect(text).toContain("/100");
  });

  it("does NOT show partial data warning in stream mode", () => {
    const text = plain(streamViewModel);
    expect(text).not.toContain("partial data");
    expect(text).not.toContain("install plugin for full report");
  });

  it("shows department name and score", () => {
    const text = plain(streamViewModel);
    expect(text).toContain("Skill & Tool");
    expect(text).toContain("58");
  });

  it("shows department checks label", () => {
    expect(plain(streamViewModel)).toContain("[10/10]");
  });

  it("shows department summary", () => {
    expect(plain(streamViewModel)).toContain("14 tools tracked | 3 need attention");
  });

  it("shows disease details under departments", () => {
    const text = plain(streamViewModel);
    expect(text).toContain("SK-002");
    expect(text).toContain("Scenario Paralysis");
  });

  it("shows Quick Actions footer in stream mode", () => {
    const text = plain(streamViewModel);
    expect(text).toContain("Quick Actions");
    expect(text).toContain("clawdoc rx apply");
  });

  it("does NOT show plugin install CTA in stream mode", () => {
    expect(plain(streamViewModel)).not.toContain("Install ClawDoc plugin");
  });

  it("outputs ANSI color codes in raw output", () => {
    const raw = renderReport(streamViewModel, "en");
    expect(raw).toContain("\x1b[");
  });
});

describe("renderReport — snapshot mode", () => {
  it("shows mode: snapshot in header", () => {
    const text = plain(snapshotViewModel);
    expect(text).toContain("Mode:");
    expect(text).toContain("snapshot");
  });

  it("shows coverage percentage in header", () => {
    const text = plain(snapshotViewModel);
    expect(text).toContain("Coverage:");
    expect(text).toContain("63%");
    expect(text).toContain("27/43");
  });

  it("shows partial data warning in snapshot mode", () => {
    expect(plain(snapshotViewModel)).toContain("partial data");
  });

  it("shows N/A for departments with null score", () => {
    const text = plain(snapshotViewModel);
    expect(text).toContain("Agent Behavior");
    expect(text).toContain("N/A");
  });

  it("shows skipped checks note for departments with skipped checks", () => {
    expect(plain(snapshotViewModel)).toContain("checks skipped");
  });

  it("shows skipped count in footer", () => {
    const text = plain(snapshotViewModel);
    expect(text).toContain("16");
    expect(text).toContain("checks skipped due to limited data");
  });

  it("shows plugin install CTA in snapshot mode footer", () => {
    expect(plain(snapshotViewModel)).toContain("Install ClawDoc plugin");
  });

  it("does NOT show Quick Actions in snapshot mode", () => {
    expect(plain(snapshotViewModel)).not.toContain("Quick Actions");
  });
});

describe("renderReport — Chinese locale", () => {
  it("renders in Chinese when locale is 'zh'", () => {
    expect(plain(streamViewModel, "zh")).toContain("ClawDoc 健康报告");
  });

  it("shows Chinese overall health label", () => {
    expect(plain(streamViewModel, "zh")).toContain("综合健康");
  });

  it("shows Chinese mode label", () => {
    expect(plain(streamViewModel, "zh")).toContain("模式");
  });

  it("shows Chinese grade label Fair→一般", () => {
    expect(plain(streamViewModel, "zh")).toContain("一般");
  });

  it("shows Chinese quick actions label", () => {
    expect(plain(streamViewModel, "zh")).toContain("快捷操作");
  });

  it("shows Chinese partial data warning in snapshot mode", () => {
    expect(plain(snapshotViewModel, "zh")).toContain("部分数据");
  });
});

describe("renderReport — department with diseases", () => {
  const deptWithMultipleDiseases: DepartmentReportLine = {
    name: "Cost Metabolism",
    score: 48,
    grade: "D",
    gradeLabel: "Poor",
    progressBar: "█████░░░░░",
    checksLabel: "[6/6]",
    summary: "7d total: 842K tokens | Daily trend: +23%",
    diseases: [
      criticalDisease,
      {
        id: "CST-003",
        name: "Cache Hit Rate Critical",
        description: "Cache hit rate critically low (12%)",
        severity: "warning",
      },
    ],
  };

  const viewModelWithCost: ReportViewModel = {
    ...streamViewModel,
    departments: [deptWithMultipleDiseases],
    diseases: [criticalDisease],
  };

  it("shows all diseases under the department", () => {
    const text = plain(viewModelWithCost);
    expect(text).toContain("CST-001");
    expect(text).toContain("CST-003");
  });

  it("shows disease descriptions", () => {
    expect(plain(viewModelWithCost)).toContain("Daily token usage exceeds warning threshold");
  });

  it("uses severity icons for diseases", () => {
    const text = plain(viewModelWithCost);
    expect(text).toContain("●"); // critical icon
    expect(text).toContain("▲"); // warning icon
  });
});

describe("progressBar", () => {
  it("is exported from progress-bar.ts and works for null score", async () => {
    const { progressBar } = await import("./progress-bar.js");
    expect(progressBar(null, 10)).toBe("──────────");
  });

  it("fills 100% for score 100", async () => {
    const { progressBar } = await import("./progress-bar.js");
    expect(progressBar(100, 10)).toBe("██████████");
  });

  it("fills 0% for score 0", async () => {
    const { progressBar } = await import("./progress-bar.js");
    expect(progressBar(0, 10)).toBe("░░░░░░░░░░");
  });

  it("fills 60% for score 60", async () => {
    const { progressBar } = await import("./progress-bar.js");
    expect(progressBar(60, 10)).toBe("██████░░░░");
  });

  it("defaults to width 10", async () => {
    const { progressBar } = await import("./progress-bar.js");
    expect(progressBar(50).length).toBe(10);
  });
});
