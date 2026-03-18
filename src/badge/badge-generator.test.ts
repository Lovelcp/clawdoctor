// ═══════════════════════════════════════════════
//  Badge Generator Tests
//  Design spec: Phase 3, Task 1
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { generateBadge } from "./badge-generator.js";
import type { BadgeOptions } from "./badge-generator.js";

// ─── Helpers ───

function badgeFor(opts: BadgeOptions): string {
  return generateBadge(opts);
}

// ─── Tests ───

describe("generateBadge", () => {
  // ── Valid SVG structure ──

  describe("SVG structure", () => {
    it("returns a string starting with <svg", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg).toMatch(/^<svg /);
    });

    it("returns a string ending with </svg>", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg.trim()).toMatch(/<\/svg>$/);
    });

    it("includes xmlns attribute for valid SVG", () => {
      const svg = badgeFor({ grade: "B", score: 75 });
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it("has a width and height attribute (approx 20px height)", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg).toContain('height="20"');
      expect(svg).toMatch(/width="\d+"/);
    });

    it("includes a <title> element for accessibility", () => {
      const svg = badgeFor({ grade: "C", score: 55 });
      expect(svg).toMatch(/<title>.+<\/title>/);
    });

    it("uses a rounded rect via clipPath rx=3", () => {
      const svg = badgeFor({ grade: "A", score: 90 });
      expect(svg).toContain('rx="3"');
    });

    it("contains two rect fill panels (label + value)", () => {
      const svg = badgeFor({ grade: "A", score: 90 });
      // label panel fill="#555"
      expect(svg).toContain('fill="#555"');
    });
  });

  // ── Grade colors ──

  describe("grade colors", () => {
    const cases: Array<{ grade: string; color: string }> = [
      { grade: "A",   color: "#4c1" },
      { grade: "B",   color: "#97CA00" },
      { grade: "C",   color: "#dfb317" },
      { grade: "D",   color: "#fe7d37" },
      { grade: "F",   color: "#e05d44" },
      { grade: "N/A", color: "#9f9f9f" },
    ];

    for (const { grade, color } of cases) {
      it(`uses color ${color} for grade ${grade}`, () => {
        const svg = badgeFor({ grade, score: 50 });
        expect(svg).toContain(color);
      });
    }

    it("uses N/A color for unknown grade", () => {
      const svg = badgeFor({ grade: "Z", score: 0 });
      expect(svg).toContain("#9f9f9f");
    });
  });

  // ── Text content ──

  describe("text content", () => {
    it("contains the grade in the SVG text", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg).toContain("A 95");
    });

    it("rounds score to nearest integer", () => {
      const svg = badgeFor({ grade: "B", score: 72.7 });
      expect(svg).toContain("B 73");
    });

    it("shows N/A text (not score) when grade is N/A", () => {
      const svg = badgeFor({ grade: "N/A", score: 0 });
      // value text should just be "N/A", not "N/A 0"
      expect(svg).toContain(">N/A<");
      expect(svg).not.toContain("N/A 0");
    });

    it("uses default label 'ClawDoctor' when label not specified", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg).toContain("ClawDoctor");
    });

    it("uses custom label when specified", () => {
      const svg = badgeFor({ grade: "A", score: 95, label: "SkillScore" });
      expect(svg).toContain("SkillScore");
      expect(svg).not.toContain("ClawDoctor");
    });

    it("includes aria-label with label and value", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg).toContain('aria-label="ClawDoctor: A 95"');
    });

    it("includes shadow text (fill-opacity=.3) for depth effect", () => {
      const svg = badgeFor({ grade: "A", score: 95 });
      expect(svg).toContain('fill-opacity=".3"');
    });
  });

  // ── Label variants ──

  describe("different grades produce different SVGs", () => {
    const grades = ["A", "B", "C", "D", "F", "N/A"] as const;

    it("each grade produces a unique SVG (different value panel color)", () => {
      // Each grade should produce a visually distinct SVG — the value panel color differs
      const svgs = grades.map((g) => badgeFor({ grade: g, score: 50 }));
      const uniqueSvgs = new Set(svgs);
      // All 6 SVGs are different because they embed different colors/text
      expect(uniqueSvgs.size).toBe(6);
    });
  });

  // ── Score boundary values ──

  describe("score boundary values", () => {
    it("handles score=0", () => {
      const svg = badgeFor({ grade: "F", score: 0 });
      expect(svg).toContain("F 0");
    });

    it("handles score=100", () => {
      const svg = badgeFor({ grade: "A", score: 100 });
      expect(svg).toContain("A 100");
    });

    it("handles fractional scores by rounding", () => {
      const svg = badgeFor({ grade: "C", score: 59.5 });
      expect(svg).toContain("C 60");
    });
  });
});
