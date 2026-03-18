import type { Prescription, ExecutionResult } from "../types/domain.js";

export function filterAutoApplicable(prescriptions: Prescription[]): Prescription[] {
  return prescriptions.filter(rx =>
    rx.level === "guided" &&
    rx.risk === "low" &&
    rx.actions.every(a => a.type === "file_edit" || a.type === "file_delete")
  );
}

export interface AutoApplyResult {
  applied: number;
  failed: number;
  results: Array<{ prescriptionId: string; success: boolean; error?: string }>;
}

export async function autoApplyPrescriptions(
  applicable: Prescription[],
  executor: { execute(id: string): Promise<ExecutionResult> },
): Promise<AutoApplyResult> {
  const results: AutoApplyResult["results"] = [];
  let applied = 0;
  let failed = 0;

  for (const rx of applicable) {
    try {
      const execResult = await executor.execute(rx.id);
      if (execResult.success) {
        applied++;
        results.push({ prescriptionId: rx.id, success: true });
      } else {
        failed++;
        results.push({ prescriptionId: rx.id, success: false, error: "execution returned false" });
      }
    } catch (err) {
      failed++;
      results.push({ prescriptionId: rx.id, success: false, error: String(err) });
    }
  }

  return { applied, failed, results };
}
