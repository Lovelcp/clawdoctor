import type { DiseaseDefinition } from "../types/domain.js";
import type { RuleResult } from "../analysis/rule-engine.js";

export interface ClawDocPlugin {
  name: string;
  version?: string;
  diseases?: DiseaseDefinition[];
  rules?: Record<string, CustomRuleEvaluator>;
}

export type CustomRuleEvaluator = (metrics: any, config: any) => RuleResult | null;
