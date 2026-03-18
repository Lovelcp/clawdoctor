import type { Prescription } from "../types/domain.js";

export function filterAutoApplicable(prescriptions: Prescription[]): Prescription[] {
  return prescriptions.filter(rx =>
    rx.level === "guided" &&
    rx.risk === "low" &&
    rx.actions.every(a => a.type === "file_edit" || a.type === "file_delete")
  );
}
