import type { DiseaseDefinition } from "../types/domain.js";
import type { RuleResult } from "../analysis/rule-engine.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";
import type { ClawInsightConfig } from "../types/config.js";

export interface ClawInsightPlugin {
  name: string;
  version?: string;
  diseases?: DiseaseDefinition[];
  rules?: Record<string, CustomRuleEvaluator>;
}

export type CustomRuleEvaluator = (
  metrics: MetricSet,
  config: ClawInsightConfig,
) => RuleResult | null;
