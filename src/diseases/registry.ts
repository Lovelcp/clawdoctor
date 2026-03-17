import type { DiseaseDefinition, Department } from "../types/domain.js";
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
