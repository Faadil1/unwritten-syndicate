import type { PredictorInput, ResolutionDisposition } from "../contracts/types.js";
import { matchesAllConditions } from "../rulebook/conditions.js";
import type { Rule } from "../rulebook/types.js";
import { extractFeatures } from "./features.js";

export interface PolicyDecision {
  readonly predicted: ResolutionDisposition;
  readonly firedRuleIds: readonly string[];
  readonly confidence: number;
}

/**
 * A PolicyAgent maps (input, activeRules) -> decision. The signature
 * deliberately carries no per-round configuration: the same agent instance
 * is reused for all 3 learning rounds by the orchestrator, which is what
 * "system prompt remains fixed across rounds, no manual prompt rewriting to
 * manufacture improvement" means structurally here — only the rulebook
 * (memory) changes between rounds, never the agent's own logic/config.
 */
export interface PolicyAgent {
  readonly name: string;
  predict(input: PredictorInput, activeRules: readonly Rule[]): PolicyDecision;
}

/** Fixed structural default when no active rule fires. Never tuned from DEV/FINAL performance. */
const DEFAULT_PRIOR: ResolutionDisposition = "RESOLVED_COMPLETED";

/**
 * Deterministic, rule-only policy agent: no model call, no randomness. Votes
 * across every active rule whose conditions match the input's feature
 * vector, weighted by confidence * supportCount, and falls back to the
 * fixed default prior when nothing fires. Determinism here is what makes
 * "deterministic snapshots under mocked outputs" testable end to end without
 * any real LLM plumbing.
 */
export class RuleBasedPolicyAgent implements PolicyAgent {
  readonly name = "rule-based-v0";

  predict(input: PredictorInput, activeRules: readonly Rule[]): PolicyDecision {
    const features = extractFeatures(input);
    const fired = activeRules.filter((r) => matchesAllConditions(features, r.conditions));
    if (fired.length === 0) {
      return { predicted: DEFAULT_PRIOR, firedRuleIds: [], confidence: 0 };
    }
    let scoreCompleted = 0;
    let scoreNoNewWork = 0;
    for (const r of fired) {
      const weight = r.confidence * r.supportCount;
      if (r.recommendedBehavior === "RESOLVED_COMPLETED") scoreCompleted += weight;
      else scoreNoNewWork += weight;
    }
    const predicted: ResolutionDisposition = scoreNoNewWork > scoreCompleted ? "RESOLVED_NO_NEW_WORK" : "RESOLVED_COMPLETED";
    const total = scoreCompleted + scoreNoNewWork;
    const confidence = total === 0 ? 0 : Math.max(scoreCompleted, scoreNoNewWork) / total;
    return { predicted, firedRuleIds: fired.map((r) => r.id), confidence };
  }
}
