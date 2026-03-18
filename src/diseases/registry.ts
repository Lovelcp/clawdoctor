import type { DiseaseDefinition, Department } from "../types/domain.js";
import type { ClawDocPlugin } from "../plugins/plugin-types.js";
import { vitalsDiseasess } from "./vitals.js";
import { skillDiseases } from "./skill.js";
import { memoryDiseases } from "./memory.js";
import { behaviorDiseases } from "./behavior.js";
import { costDiseases } from "./cost.js";
import { securityDiseases } from "./security.js";

const ALL_DISEASES: DiseaseDefinition[] = [
  ...vitalsDiseasess,
  ...skillDiseases,
  ...memoryDiseases,
  ...behaviorDiseases,
  ...costDiseases,
  ...securityDiseases,
];

export interface DiseaseRegistry {
  getAll(): DiseaseDefinition[];
  getById(id: string): DiseaseDefinition | undefined;
  getByDepartment(department: Department): DiseaseDefinition[];
}

export function getDiseaseRegistry(): DiseaseRegistry {
  return {
    getAll(): DiseaseDefinition[] {
      return ALL_DISEASES;
    },

    getById(id: string): DiseaseDefinition | undefined {
      return ALL_DISEASES.find((d) => d.id === id);
    },

    getByDepartment(department: Department): DiseaseDefinition[] {
      return ALL_DISEASES.filter((d) => d.department === department);
    },
  };
}

/**
 * Merge plugin diseases into a base registry.
 *
 * Plugin disease IDs must not conflict with built-in IDs.
 * Conflicting IDs are warned and skipped.
 */
export function createMergedRegistry(
  base: DiseaseRegistry,
  plugins: ClawDocPlugin[],
): DiseaseRegistry {
  const builtinIds = new Set(base.getAll().map((d) => d.id));
  const extra: DiseaseDefinition[] = [];

  for (const plugin of plugins) {
    if (!plugin.diseases || plugin.diseases.length === 0) continue;
    for (const disease of plugin.diseases) {
      if (builtinIds.has(disease.id)) {
        console.warn(
          `[clawdoc] Plugin "${plugin.name}" disease "${disease.id}" conflicts with a built-in disease ID. Skipping.`,
        );
        continue;
      }
      if (extra.some((e) => e.id === disease.id)) {
        console.warn(
          `[clawdoc] Plugin "${plugin.name}" disease "${disease.id}" conflicts with another plugin's disease ID. Skipping.`,
        );
        continue;
      }
      extra.push(disease);
    }
  }

  if (extra.length === 0) return base;

  const merged = [...base.getAll(), ...extra];

  return {
    getAll(): DiseaseDefinition[] {
      return merged;
    },

    getById(id: string): DiseaseDefinition | undefined {
      return merged.find((d) => d.id === id);
    },

    getByDepartment(department: Department): DiseaseDefinition[] {
      return merged.filter((d) => d.department === department);
    },
  };
}
