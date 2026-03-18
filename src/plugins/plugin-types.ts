import type { DiseaseDefinition } from "../types/domain.js";
import type { RuleResult } from "../analysis/rule-engine.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";
import type { ClawDocConfig } from "../types/config.js";

export interface ClawDocPlugin {
  name: string;
  version?: string;
  diseases?: DiseaseDefinition[];
  rules?: Record<string, CustomRuleEvaluator>;
}

export type CustomRuleEvaluator = (
  metrics: MetricSet,
  config: ClawDocConfig,
) => RuleResult | null;
