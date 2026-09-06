/**
 * Shared contracts for the Unwritten Data + Eval layer.
 *
 * Frozen upstream definitions: docs/EVAL_CONTRACT.md §12.1 (labels),
 * §12.6 (predictor input contract), §12.7 (evaluator-only subtype).
 * Do not add fields to PredictorInput without a new numbered gate.
 */

/** The two frozen prediction classes. See EVAL_CONTRACT.md §12.1. */
export type ResolutionDisposition = "RESOLVED_COMPLETED" | "RESOLVED_NO_NEW_WORK";

/** Evaluator-only diagnostic subtype, never a predictor input or scoring target. See §12.7. */
export type ResolutionSubtype = "COMPLETED" | "NOT_PLANNED" | "DUPLICATE";

export type SplitName = "TRAIN" | "DEV" | "FINAL_HOLDOUT";

export type AuthorAssociation = "NONE" | "FIRST_TIME_CONTRIBUTOR" | "CONTRIBUTOR";

/**
 * Everything a predictor is permitted to see for a given issue, at the moment
 * of prediction. This is the ENTIRE surface — no other field may be added to
 * this type or to any object serialized for a predictor. See EVAL_CONTRACT.md §12.6.
 */
export interface PredictorInput {
  readonly title: string;
  readonly body: string;
  readonly createdAt: string; // ISO-8601 UTC
  readonly authorAssociation: AuthorAssociation;
}

/**
 * Evaluator-only ground truth for a single issue. Never passed to a predictor.
 */
export interface GroundTruth {
  readonly number: number;
  readonly label: ResolutionDisposition;
  readonly subtype: ResolutionSubtype;
  readonly createdAt: string;
}

/**
 * A resolved issue available for historical lookup by number/date, distinct
 * from PredictorInput: a HistoricalRecord may carry the resolution outcome,
 * because it describes a PAST, already-resolved case being consulted for
 * context — not the current issue being classified. The temporal guard
 * (historical.createdAt < current.createdAt) is what keeps this safe; see
 * src/data/guards.ts.
 */
export interface HistoricalRecord {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly authorAssociation: AuthorAssociation;
  readonly label: ResolutionDisposition;
  readonly subtype: ResolutionSubtype;
}

export interface Prediction {
  readonly number: number;
  readonly predicted: ResolutionDisposition;
  /** Set only if the predictor errored/timed out instead of returning a label. */
  readonly error?: string;
}

export interface ConfusionCounts {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly trueNegative: number;
}

export interface PerClassMetric {
  readonly label: ResolutionDisposition;
  readonly support: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface EvaluationResult {
  readonly split: SplitName;
  readonly totalRecords: number;
  readonly scored: number;
  readonly errored: number;
  readonly accuracy: number;
  readonly macroF1: number;
  readonly perClass: readonly PerClassMetric[];
  readonly confusionMatrix: {
    readonly labels: readonly ResolutionDisposition[];
    /** rows = truth, cols = predicted, same order as `labels` */
    readonly matrix: readonly (readonly number[])[];
  };
}

/**
 * A single learned/synthesized behavioral rule, as consumed by A2's
 * scrambled-rulebook baseline. Kept minimal here — the full Rulebook
 * authoring/learning engine (src/learning/**, src/rulebook/**) is owned by
 * a different session; this layer only needs a shape stable enough to
 * permute deterministically for A2.
 */
export interface PolicyRule {
  readonly id: string;
  readonly recommendedBehavior: string;
  readonly rationale?: string;
}

export interface RulebookSnapshot {
  readonly version: "V3";
  readonly rules: readonly PolicyRule[];
}

/** A single recorded tool invocation, for future instrumentation/audit use. */
export interface ToolTrace {
  readonly tool: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly startedAt: string;
  readonly finishedAt: string;
}
