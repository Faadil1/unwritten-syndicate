import { matchesAllConditions } from "./conditions.js";
import type { Rule } from "./types.js";
import type { ResolutionDisposition } from "../contracts/types.js";
import { extractFeatures } from "../learning/features.js";
import type {
  ToolHeuristicContext,
  ToolHeuristicDecision,
  ToolHeuristicHooks,
} from "../tools/toolHeuristics.js";

/** A matching active rule needs at least this much *absolute* confidence... */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
/** ...backed by at least this much TRAIN evidence, before the Rulebook is trusted over a fresh search. */
const MIN_SUPPORT_FOR_HIGH_CONFIDENCE = 3;
/** Matches the frozen DEV historical-search top-k budget (src/eval/retrievalConfig.ts): one search call exhausts it. */
const MAX_USEFUL_SEARCHES = 1;
/**
 * A matching rule only *suppresses* a historical search if it is decisively
 * better than the base rate its own TRAIN evidence implies: it must cut the
 * residual base-rate error at least in half. `1 - (1 - p0) / 2` is that
 * "halve the error" bar for a class prior `p0` (equivalently, be at least
 * halfway from the prior to certainty). This is what makes the gate about
 * *this input's* discriminability rather than "some active rule exists":
 * single-feature marginal rules whose confidence merely tracks the dominant
 * class frequency no longer clear it. See ERROR_HALVING_MARGIN uses below.
 */
function errorHalvingBar(prior: number): number {
  return 1 - (1 - prior) / 2;
}

function matchingActiveRules(ctx: ToolHeuristicContext, activeRules: readonly Rule[]): readonly Rule[] {
  const features = extractFeatures(ctx.input);
  return activeRules.filter((r) => matchesAllConditions(features, r.conditions));
}

/** Ranks by confidence * supportCount, same weighting RuleBasedPolicyAgent uses to vote. */
function strongestMatch(rules: readonly Rule[]): Rule | null {
  if (rules.length === 0) return null;
  return rules.reduce((best, r) => (r.confidence * r.supportCount > best.confidence * best.supportCount ? r : best));
}

/**
 * The dominant-class base rate for `behavior` that the Rulebook's OWN
 * TRAIN evidence implies — derived only from Rule fields already present in
 * the frozen snapshot, never from DEV/FINAL truth.
 *
 * Uses single-feature rule groups that partition a feature (>= 2 distinct
 * values covered). Within such a group every TRAIN example is counted exactly
 * once, so `#(truth == behavior) / #(examples)` is an unbiased marginal
 * frequency: for a rule that *recommends* `behavior`, its successCount is the
 * count of matching examples whose truth was `behavior`; for a rule that
 * recommends something else, its failureCount is that same count. The widest
 * such partition (most TRAIN support) wins; `null` if no partition exists
 * (e.g. a single isolated rule), in which case only the absolute floor applies.
 */
function rulebookClassPrior(activeRules: readonly Rule[], behavior: ResolutionDisposition): number | null {
  const singleFeatureGroups = new Map<string, Rule[]>();
  for (const r of activeRules) {
    if (r.conditions.length !== 1) continue;
    const key = r.conditions[0]!.feature;
    const group = singleFeatureGroups.get(key);
    if (group) group.push(r);
    else singleFeatureGroups.set(key, [r]);
  }

  let prior: number | null = null;
  let widestSupport = 0;
  for (const group of singleFeatureGroups.values()) {
    const distinctValues = new Set(
      group.map((r) => `${r.conditions[0]!.operator}:${String(r.conditions[0]!.value ?? "")}`),
    );
    if (distinctValues.size < 2) continue; // not a partition — cannot infer a marginal frequency
    let truthIsBehavior = 0;
    let total = 0;
    for (const r of group) {
      total += r.supportCount;
      truthIsBehavior += r.recommendedBehavior === behavior ? r.successCount : r.failureCount;
    }
    if (total > widestSupport && total > 0) {
      widestSupport = total;
      prior = truthIsBehavior / total;
    }
  }
  return prior;
}

/**
 * The confidence a matching rule must reach before its recommendation is
 * trusted *instead of* issuing a historical search: the absolute floor, OR
 * the "halve the base-rate error" bar if the Rulebook's own evidence lets us
 * estimate that base rate — whichever is higher.
 */
function sufficiencyThreshold(activeRules: readonly Rule[], behavior: ResolutionDisposition): number {
  const prior = rulebookClassPrior(activeRules, behavior);
  if (prior === null) return HIGH_CONFIDENCE_THRESHOLD;
  return Math.max(HIGH_CONFIDENCE_THRESHOLD, errorHalvingBar(prior));
}

type MatchAssessment =
  | { readonly kind: "no-match" }
  | { readonly kind: "contradictory"; readonly rules: readonly Rule[] }
  | { readonly kind: "sufficient"; readonly rule: Rule; readonly threshold: number }
  | { readonly kind: "insufficient"; readonly rule: Rule; readonly threshold: number };

/**
 * Classifies the current input against the active rules. The product
 * semantics this encodes:
 *   - no applicable rule            -> search (nothing to be confident from);
 *   - applicable rules disagree     -> search (contradictory policy);
 *   - one strong, well-supported,
 *     base-rate-beating rule        -> high-confidence sufficient, skip search;
 *   - otherwise (low confidence /
 *     only-marginal signal)         -> search.
 * Crucially the "sufficient" branch is NOT reachable merely because the
 * Rulebook happens to have total feature coverage: a rule whose confidence
 * only tracks the dominant-class frequency fails `sufficiencyThreshold`.
 */
function assessMatch(ctx: ToolHeuristicContext, activeRules: readonly Rule[]): MatchAssessment {
  const matches = matchingActiveRules(ctx, activeRules);
  if (matches.length === 0) return { kind: "no-match" };

  const distinctBehaviors = new Set(matches.map((r) => r.recommendedBehavior));
  if (distinctBehaviors.size > 1) return { kind: "contradictory", rules: matches };

  const rule = strongestMatch(matches)!;
  const threshold = sufficiencyThreshold(activeRules, rule.recommendedBehavior);
  if (rule.confidence >= threshold && rule.supportCount >= MIN_SUPPORT_FOR_HIGH_CONFIDENCE) {
    return { kind: "sufficient", rule, threshold };
  }
  return { kind: "insufficient", rule, threshold };
}

function isHighConfidence(rule: Rule, threshold: number): boolean {
  return rule.confidence >= threshold && rule.supportCount >= MIN_SUPPORT_FOR_HIGH_CONFIDENCE;
}

/**
 * Adapts a Rulebook's active, evidence-backed rules into ToolHeuristicHooks
 * (src/tools/toolHeuristics.ts) — the smallest deterministic bridge between
 * the memory/learning engine (src/rulebook/**, src/learning/**) and the tool
 * layer's hook mechanism (src/tools/**), per the integration brief.
 *
 * The policy is intentionally simple and fully explainable from the Rule
 * evidence fields alone: historical search is treated as unnecessary only
 * when a single active rule matches the current input's abstracted features
 * AND is confident enough to cut its own TRAIN-implied base-rate error in
 * half (with the matching rules in agreement, over enough TRAIN support);
 * every other situation — no applicable rule, contradictory rules, or a rule
 * whose confidence merely reflects the dominant class frequency — permits a
 * search. This is the ONLY thing that may differ between A1 (raw-RAG, no
 * Rulebook, always searches) and A3 (real learned Rulebook) — both must be
 * built over the identical historical-search corpus/temporal-filter/top-k/
 * ranking (see src/eval/retrievalConfig.ts and src/eval/harness.ts
 * makeA1Predictor / makeA3Predictor), so this adapter governs WHETHER/HOW
 * search is used, not a different or better retrieval configuration.
 */
export function createRulebookToolHeuristics(activeRules: readonly Rule[]): ToolHeuristicHooks {
  const sufficientDecision = (rule: Rule, threshold: number): ToolHeuristicDecision => ({
    action: "HIGH_CONFIDENCE_SUFFICIENT",
    reason: `active rule ${rule.id} matches with confidence ${rule.confidence.toFixed(2)} over ${rule.supportCount} TRAIN example(s), clearing the base-rate-beating bar ${threshold.toFixed(2)}; skipping search`,
  });

  const searchDecision = (ctx: ToolHeuristicContext): ToolHeuristicDecision => {
    const assessment = assessMatch(ctx, activeRules);
    switch (assessment.kind) {
      case "no-match":
        return { action: "SEARCH", reason: "no active rule matches this input's abstracted features" };
      case "contradictory":
        return {
          action: "SEARCH",
          reason: `matching active rules disagree (${[...new Set(assessment.rules.map((r) => r.recommendedBehavior))].join(" vs ")}); historical evidence needed to break the tie`,
        };
      case "insufficient":
        return {
          action: "SEARCH",
          reason: `strongest matching rule ${assessment.rule.id} confidence ${assessment.rule.confidence.toFixed(2)} does not clear the base-rate-beating bar ${assessment.threshold.toFixed(2)} (or lacks support); only a marginal signal, so search`,
        };
      case "sufficient":
        return sufficientDecision(assessment.rule, assessment.threshold);
    }
  };

  return {
    shouldSearch: searchDecision,
    isHighConfidenceSufficient: (ctx) => {
      const assessment = assessMatch(ctx, activeRules);
      if (assessment.kind === "sufficient") return sufficientDecision(assessment.rule, assessment.threshold);
      return { action: "SEARCH", reason: "no sufficiently confident, well-supported, base-rate-beating active rule for this input" };
    },
    isFurtherSearchUnlikelyToHelp: (ctx) => {
      if (ctx.searchesPerformedSoFar >= MAX_USEFUL_SEARCHES) {
        return {
          action: "FURTHER_SEARCH_UNLIKELY_TO_HELP",
          reason: `already performed ${ctx.searchesPerformedSoFar} search(es) at the fixed top-k budget; another call returns the same frozen corpus slice`,
        };
      }
      return { action: "SEARCH", reason: "search budget not yet exhausted" };
    },
    shouldAbstainOrEscalate: (ctx) => {
      const assessment = assessMatch(ctx, activeRules);
      if (assessment.kind === "no-match" && ctx.searchesPerformedSoFar >= MAX_USEFUL_SEARCHES && (ctx.lastResultCount ?? 0) === 0) {
        return {
          action: "ABSTAIN_OR_ESCALATE",
          reason: "no matching active rule and historical search returned no results",
        };
      }
      return { action: "SEARCH", reason: "policy or search evidence is still available" };
    },
  };
}

export const __testing = { rulebookClassPrior, sufficiencyThreshold, errorHalvingBar, isHighConfidence };
