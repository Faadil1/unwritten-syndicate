import { matchesAllConditions } from "./conditions.js";
import type { Rule } from "./types.js";
import { extractFeatures } from "../learning/features.js";
import type {
  ToolHeuristicContext,
  ToolHeuristicDecision,
  ToolHeuristicHooks,
} from "../tools/toolHeuristics.js";

/** A matching active rule needs at least this much confidence... */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
/** ...backed by at least this much TRAIN evidence, before the Rulebook is trusted over a fresh search. */
const MIN_SUPPORT_FOR_HIGH_CONFIDENCE = 3;
/** Matches the frozen DEV historical-search top-k budget (src/eval/retrievalConfig.ts): one search call exhausts it. */
const MAX_USEFUL_SEARCHES = 1;

function matchingActiveRules(ctx: ToolHeuristicContext, activeRules: readonly Rule[]): readonly Rule[] {
  const features = extractFeatures(ctx.input);
  return activeRules.filter((r) => matchesAllConditions(features, r.conditions));
}

/** Ranks by confidence * supportCount, same weighting RuleBasedPolicyAgent uses to vote. */
function strongestMatch(rules: readonly Rule[]): Rule | null {
  if (rules.length === 0) return null;
  return rules.reduce((best, r) => (r.confidence * r.supportCount > best.confidence * best.supportCount ? r : best));
}

function isHighConfidence(rule: Rule): boolean {
  return rule.confidence >= HIGH_CONFIDENCE_THRESHOLD && rule.supportCount >= MIN_SUPPORT_FOR_HIGH_CONFIDENCE;
}

/**
 * Adapts a Rulebook's active, evidence-backed rules into ToolHeuristicHooks
 * (src/tools/toolHeuristics.ts) — the smallest deterministic bridge between
 * the memory/learning engine (src/rulebook/**, src/learning/**) and the tool
 * layer's hook mechanism (src/tools/**), per the integration brief.
 *
 * The policy is intentionally simple and fully explainable from the Rule
 * evidence fields alone: if an active rule matches the current input's
 * abstracted features with high confidence over enough TRAIN support,
 * historical search is treated as unnecessary; otherwise, search proceeds.
 * This is the ONLY thing that may differ between A1 (raw-RAG, no Rulebook,
 * always searches) and A3 (real learned Rulebook) — both must be built over
 * the identical historical-search corpus/temporal-filter/top-k/ranking (see
 * src/eval/retrievalConfig.ts and src/eval/harness.ts makeA1Predictor /
 * makeA3Predictor), so this adapter governs WHETHER/HOW search is used, not
 * a different or better retrieval configuration.
 */
export function createRulebookToolHeuristics(activeRules: readonly Rule[]): ToolHeuristicHooks {
  const decide = (ctx: ToolHeuristicContext): Rule | null => strongestMatch(matchingActiveRules(ctx, activeRules));

  const sufficientDecision = (rule: Rule): ToolHeuristicDecision => ({
    action: "HIGH_CONFIDENCE_SUFFICIENT",
    reason: `active rule ${rule.id} matches with confidence ${rule.confidence.toFixed(2)} over ${rule.supportCount} TRAIN example(s); skipping search`,
  });

  return {
    shouldSearch: (ctx) => {
      const rule = decide(ctx);
      if (rule && isHighConfidence(rule)) return sufficientDecision(rule);
      return {
        action: "SEARCH",
        reason: rule
          ? `matching active rule ${rule.id} confidence ${rule.confidence.toFixed(2)} below the ${HIGH_CONFIDENCE_THRESHOLD} threshold`
          : "no active rule matches this input's abstracted features",
      };
    },
    isHighConfidenceSufficient: (ctx) => {
      const rule = decide(ctx);
      if (rule && isHighConfidence(rule)) return sufficientDecision(rule);
      return { action: "SEARCH", reason: "no sufficiently confident, well-supported active rule for this input" };
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
      const rule = decide(ctx);
      if (!rule && ctx.searchesPerformedSoFar >= MAX_USEFUL_SEARCHES && (ctx.lastResultCount ?? 0) === 0) {
        return {
          action: "ABSTAIN_OR_ESCALATE",
          reason: "no matching active rule and historical search returned no results",
        };
      }
      return { action: "SEARCH", reason: "policy or search evidence is still available" };
    },
  };
}
