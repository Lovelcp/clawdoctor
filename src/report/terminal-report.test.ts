import { describe, it, expect } from "vitest";
import { renderReport } from "./terminal-report.js";
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("renderReport — stream mode", () => {
  it("contains the report title", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("ClawDoc Health Report");
  });

  it("shows agent ID in header", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Agent: default");
  });

  it("shows date range in header", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("2026-03-10 ~ 2026-03-17");
  });

  it("shows 'Mode: stream' in header", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Mode: stream");
  });

  it("shows coverage in header", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Coverage: 100%");
    expect(output).toContain("43/43");
  });

  it("shows overall health line with score and grade", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Overall Health");
    expect(output).toContain("61");
    expect(output).toContain("Grade C");
  });

  it("does NOT show partial data warning in stream mode", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).not.toContain("partial data");
    expect(output).not.toContain("install plugin for full report");
  });

  it("shows department score", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Skill & Tool");
    expect(output).toContain("58");
  });

  it("shows department grade label", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Fair");
  });

  it("shows department checks label", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("[10/10]");
  });

  it("shows department summary", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("14 tools tracked | 3 need attention");
  });

  it("shows disease details under departments", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("SK-002");
    expect(output).toContain("Scenario Paralysis");
  });

  it("shows Quick Actions footer in stream mode", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("Quick Actions");
    expect(output).toContain("clawdoc rx apply");
  });

  it("does NOT show plugin install CTA in stream mode", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).not.toContain("Install ClawDoc plugin");
  });

  it("has box border characters", () => {
    const output = renderReport(streamViewModel, "en");
    expect(output).toContain("┌");
    expect(output).toContain("┐");
    expect(output).toContain("└");
    expect(output).toContain("┘");
    expect(output).toContain("│");
    expect(output).toContain("─");
  });
});

describe("renderReport — snapshot mode", () => {
  it("shows 'Mode: snapshot' in header", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("Mode: snapshot");
  });

  it("shows coverage percentage in header", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("Coverage: 63%");
    expect(output).toContain("27/43");
  });

  it("shows partial data warning in snapshot mode", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("partial data");
  });

  it("shows N/A for departments with null score", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("Agent Behavior");
    expect(output).toContain("N/A");
  });

  it("shows skipped checks note for departments with skipped checks", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("checks skipped");
  });

  it("shows skipped count in footer", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("16");
    expect(output).toContain("checks skipped due to limited data");
  });

  it("shows plugin install CTA in snapshot mode footer", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).toContain("Install ClawDoc plugin");
  });

  it("does NOT show Quick Actions in snapshot mode", () => {
    const output = renderReport(snapshotViewModel, "en");
    expect(output).not.toContain("Quick Actions");
  });
});

describe("renderReport — Chinese locale", () => {
  it("renders in Chinese when locale is 'zh'", () => {
    const output = renderReport(streamViewModel, "zh");
    expect(output).toContain("ClawDoc 健康报告");
  });

  it("shows Chinese overall health label", () => {
    const output = renderReport(streamViewModel, "zh");
    expect(output).toContain("综合健康");
  });

  it("shows Chinese mode label", () => {
    const output = renderReport(streamViewModel, "zh");
    expect(output).toContain("模式");
  });

  it("shows Chinese grade label Fair→一般", () => {
    const output = renderReport(streamViewModel, "zh");
    expect(output).toContain("一般"); // Fair → 一般
  });

  it("shows Chinese quick actions label", () => {
    const output = renderReport(streamViewModel, "zh");
    expect(output).toContain("快捷操作");
  });

  it("shows Chinese partial data warning in snapshot mode", () => {
    const output = renderReport(snapshotViewModel, "zh");
    expect(output).toContain("部分数据");
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
    const output = renderReport(viewModelWithCost, "en");
    expect(output).toContain("CST-001");
    expect(output).toContain("CST-003");
  });

  it("shows disease descriptions", () => {
    const output = renderReport(viewModelWithCost, "en");
    expect(output).toContain("Daily token usage exceeds warning threshold");
  });
});

describe("progressBar", () => {
  it("is exported from terminal-report and works for null score", async () => {
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
