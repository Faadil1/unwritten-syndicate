import type { PredictorInput, ResolutionDisposition, SplitName } from "../contracts/types.js";
import { conditionsSignature, matchesAllConditions } from "../rulebook/conditions.js";
import { CONDITION_FEATURES, type ConditionFeature, type ConditionOperator, type Rule, type RuleCondition, type RuleType } from "../rulebook/types.js";
import type { NewRuleProposal } from "../rulebook/rulebook.js";
import { extractFeatures } from "./features.js";

/**
 * A single revealed TRAIN example: this round's prediction plus the actual
 * TRAIN label. `split` is carried explicitly (rather than assumed) so the
 * TRAIN-only guard below is an enforced runtime check, not a naming
 * convention — reflect() throws if handed anything from DEV/FINAL_HOLDOUT.
 */
export interface RevealedExample {
  readonly number: number;
  readonly split: SplitName;
  readonly input: PredictorInput;
  readonly predicted: ResolutionDisposition;
  readonly actual: ResolutionDisposition;
}

export interface OutcomeRecord {
  readonly ruleId: string;
  readonly success: boolean;
}

export interface MemoryDelta {
  readonly proposals: readonly NewRuleProposal[];
  readonly outcomeRecords: readonly OutcomeRecord[];
  readonly examplesConsidered: number;
}

/** A feature-value group needs at least this many examples before it's eligible to become a rule proposal. */
const MIN_GROUP_SUPPORT = 3;
/** ...and the majority outcome within that group must be at least this pure. */
const MIN_GROUP_PURITY = 0.7;

function assertTrainOnly(examples: readonly RevealedExample[]): void {
  const offending = examples.filter((e) => e.split !== "TRAIN");
  if (offending.length > 0) {
    const splits = [...new Set(offending.map((e) => e.split))].join(", ");
    throw new Error(
      `Reflector.reflect() may only learn from TRAIN feedback; received example(s) from split(s): ${splits}. ` +
        `DEV and FINAL_HOLDOUT must never update memory (see EVAL_CONTRACT.md / IMPLEMENTATION_PLAN.md ordering constraint).`,
    );
  }
}

function ruleTypeFor(feature: ConditionFeature): RuleType {
  return feature === "authorAssociation" ? "authorship_signal" : "content_shape_signal";
}

/**
 * The Reflector: given a batch of revealed TRAIN examples plus the current
 * active rules, proposes a memory delta (new candidate rule proposals +
 * outcome updates for existing active rules that fired). It never mutates
 * the Rulebook directly and never persists anything — the orchestrator
 * applies the delta and calls Rulebook.consolidate() explicitly, keeping
 * "propose" and "consolidate" as separate, individually testable steps.
 */
export class Reflector {
  reflect(_round: number, examples: readonly RevealedExample[], activeRules: readonly Rule[]): MemoryDelta {
    assertTrainOnly(examples);
    const outcomeRecords = this.scoreActiveRules(examples, activeRules);
    const proposals = this.proposeRules(examples, activeRules);
    return { proposals, outcomeRecords, examplesConsidered: examples.length };
  }

  /** Every active rule that fires on a revealed example gets an outcome record — this is how support/success/failure/confidence stay evidence-backed round over round. */
  private scoreActiveRules(examples: readonly RevealedExample[], activeRules: readonly Rule[]): OutcomeRecord[] {
    const records: OutcomeRecord[] = [];
    for (const ex of examples) {
      const features = extractFeatures(ex.input);
      for (const rule of activeRules) {
        if (matchesAllConditions(features, rule.conditions)) {
          records.push({ ruleId: rule.id, success: rule.recommendedBehavior === ex.actual });
        }
      }
    }
    return records;
  }

  /**
   * Generalizes across this round's examples by grouping on each single
   * abstracted feature's value and checking whether the group's outcome is
   * dominated by one disposition. This is the abstraction step: a proposal's
   * evidence is a (feature, value) -> outcome-distribution summary, never a
   * list of issue numbers or verbatim text, so it is structurally impossible
   * to reconstruct "issue #1234 -> RESOLVED_COMPLETED" from a proposal.
   */
  private proposeRules(examples: readonly RevealedExample[], activeRules: readonly Rule[]): NewRuleProposal[] {
    // A (conditions, recommendedBehavior) pair already backed by an ACTIVE
    // rule has its evidence grown exclusively via scoreActiveRules above —
    // regenerating an equivalent proposal here from the same examples would
    // double-count that evidence once the two merge in the Rulebook.
    const activeSignatures = new Set(
      activeRules.map((r) => `${conditionsSignature(r.conditions)}|${r.recommendedBehavior}`),
    );
    const proposals: NewRuleProposal[] = [];
    for (const feature of CONDITION_FEATURES) {
      const groups = new Map<string, readonly RevealedExample[]>();
      for (const ex of examples) {
        const value = extractFeatures(ex.input)[feature];
        const key = String(value);
        const group = groups.get(key) ?? [];
        groups.set(key, [...group, ex]);
      }
      for (const [, group] of groups) {
        if (group.length < MIN_GROUP_SUPPORT) continue;
        const value = extractFeatures(group[0]!.input)[feature];
        const operator: ConditionOperator = typeof value === "boolean" ? (value ? "truthy" : "falsy") : "equals";
        const condition: RuleCondition = { feature, operator, ...(operator === "equals" ? { value } : {}) };
        const completedCount = group.filter((g) => g.actual === "RESOLVED_COMPLETED").length;
        const noNewWorkCount = group.length - completedCount;
        const recommendedBehavior: ResolutionDisposition =
          completedCount >= noNewWorkCount ? "RESOLVED_COMPLETED" : "RESOLVED_NO_NEW_WORK";
        const successCount = Math.max(completedCount, noNewWorkCount);
        const failureCount = group.length - successCount;
        const purity = successCount / group.length;
        if (purity < MIN_GROUP_PURITY) continue;
        const signature = `${conditionsSignature([condition])}|${recommendedBehavior}`;
        if (activeSignatures.has(signature)) continue;
        proposals.push({
          type: ruleTypeFor(feature),
          conditions: [condition],
          recommendedBehavior,
          supportCount: group.length,
          successCount,
          failureCount,
          note: `Generalized from ${group.length} TRAIN examples sharing ${feature}=${String(value)} (purity ${purity.toFixed(2)}).`,
        });
      }
    }
    return proposals;
  }
}
