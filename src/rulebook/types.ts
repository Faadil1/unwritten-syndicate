/**
 * Rulebook memory-engine types (Session B: Rule Learning).
 *
 * These types are intentionally separate from the minimal
 * `src/contracts/types.ts` PolicyRule/RulebookSnapshot (owned by the Data +
 * Eval session, frozen for A2 scrambled-rulebook plumbing). This module owns
 * the full evidence-backed rule schema; `snapshot.ts` bridges the two by
 * projecting active rules down to the frozen contracts shape when needed.
 */
import type { ResolutionDisposition } from "../contracts/types.js";

export type RuleStatus = "candidate" | "active" | "contradicted" | "retired";

/**
 * `authorship_signal` conditions key only on authorAssociation; other
 * signals derive from shape-of-content features. `composite` is reserved for
 * future multi-feature generalizations. Kept as an open union of literals
 * (not a bare string) so new types must be added deliberately.
 */
export type RuleType = "authorship_signal" | "content_shape_signal" | "composite";

export type ConditionOperator = "equals" | "truthy" | "falsy" | "gte" | "lte";

/**
 * The ONLY features a rule condition may reference. This is the structural
 * guardrail against issue->outcome memorization: a condition can never key on
 * an issue number, verbatim title/body text, or any other raw identity
 * field, because those literals do not exist in this closed vocabulary.
 * Extending this list is a deliberate design decision, not something the
 * Reflector can do implicitly.
 */
export const CONDITION_FEATURES = [
  "authorAssociation",
  "bodyLengthBucket",
  "titleLengthBucket",
  "hasQuestionMark",
  "hasCodeBlock",
] as const;
export type ConditionFeature = (typeof CONDITION_FEATURES)[number];

export type FeatureValue = string | number | boolean;
export type FeatureVector = Readonly<Record<ConditionFeature, FeatureValue>>;

export interface RuleCondition {
  readonly feature: ConditionFeature;
  readonly operator: ConditionOperator;
  /** Required for "equals"/"gte"/"lte"; omitted for "truthy"/"falsy". */
  readonly value?: string | number | boolean;
}

/**
 * A single learned, evidence-backed policy rule. Every field listed here
 * mirrors the frozen field list from the session brief; on-disk snapshots
 * (memory/V*.json) serialize these as snake_case (see snapshot.ts).
 */
export interface Rule {
  readonly id: string;
  readonly type: RuleType;
  readonly conditions: readonly RuleCondition[];
  readonly recommendedBehavior: ResolutionDisposition;
  readonly confidence: number;
  readonly supportCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly contradictionCount: number;
  readonly createdRound: number;
  readonly updatedRound: number;
  readonly status: RuleStatus;
}

/**
 * Provenance is tracked separately from the Rule itself (per the session
 * brief: "Keep provenance separate") so that the scoring-relevant Rule shape
 * stays small and the audit trail (evidence volume, merge lineage) can grow
 * independently without bloating every rule object.
 */
export interface RuleProvenance {
  readonly createdFromRound: number;
  readonly evidenceExampleCount: number;
  /** Rule ids absorbed into this rule via dedupe/merge, oldest first. */
  readonly sourceRuleIds: readonly string[];
  readonly note?: string;
}

export interface CompressionMetrics {
  readonly examplesSeen: number;
  readonly candidateRules: number;
  readonly activeRules: number;
  readonly retiredRules: number;
  readonly contradictions: number;
  /** examplesSeen / max(1, activeRules) — how many TRAIN examples each surviving active rule "explains" on average. */
  readonly compressionRatio: number;
}

export type SnapshotVersion = "V0" | "V1" | "V2" | "V3";

export interface RulebookVersionSnapshot {
  readonly version: SnapshotVersion;
  readonly round: number;
  /** ALL rules regardless of status — the full audit trail, not just active ones. */
  readonly rules: readonly Rule[];
  readonly provenance: Readonly<Record<string, RuleProvenance>>;
  readonly metrics: CompressionMetrics;
}
