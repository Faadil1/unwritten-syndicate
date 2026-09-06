import type { PredictorInput } from "../contracts/types.js";

/**
 * Rulebook TOOL_HEURISTIC hook points.
 *
 * This module defines the MECHANISM only: the hook signatures a Rulebook
 * (or any policy layer) can implement to decide (a) when search is needed,
 * (b) when high-confidence policy is already enough, (c) when further
 * search is unlikely to change the outcome, and (d) when to abstain/escalate
 * instead of committing to a label. Per the owning task's instructions:
 * "Expose the mechanism; do not invent learned heuristics yourself." The
 * actual learned policy behind these hooks belongs to the Rulebook /
 * learning-engine session (src/rulebook/**, src/learning/**), not this one.
 */

export type ToolHeuristicAction =
  | "SEARCH"
  | "HIGH_CONFIDENCE_SUFFICIENT"
  | "FURTHER_SEARCH_UNLIKELY_TO_HELP"
  | "ABSTAIN_OR_ESCALATE";

export interface ToolHeuristicDecision {
  readonly action: ToolHeuristicAction;
  readonly reason: string;
}

export interface ToolHeuristicContext {
  readonly input: PredictorInput;
  readonly searchesPerformedSoFar: number;
  /** Result count of the most recent search, or null if none has run yet. */
  readonly lastResultCount: number | null;
  /** Caller-supplied confidence in [0, 1], or null if not tracked/available. */
  readonly currentConfidence: number | null;
}

export interface ToolHeuristicHooks {
  /** Should a(nother) historical search be issued right now? */
  readonly shouldSearch: (ctx: ToolHeuristicContext) => ToolHeuristicDecision;
  /** Is current policy/rulebook confidence already high enough to skip search? */
  readonly isHighConfidenceSufficient: (ctx: ToolHeuristicContext) => ToolHeuristicDecision;
  /** Would issuing further search plausibly change the eventual prediction? */
  readonly isFurtherSearchUnlikelyToHelp: (ctx: ToolHeuristicContext) => ToolHeuristicDecision;
  /** Should the predictor abstain or escalate instead of committing to a label? */
  readonly shouldAbstainOrEscalate: (ctx: ToolHeuristicContext) => ToolHeuristicDecision;
}

/**
 * Mechanical placeholder hooks — NOT a learned policy. Every hook always
 * defers to "search," uniformly, regardless of context. A real, learned
 * implementation now exists (see src/rulebook/toolHeuristicAdapter.ts
 * createRulebookToolHeuristics) and is the canonical A3 policy; this
 * passthrough must only be used as a test fixture / fallback when no
 * Rulebook is available (e.g. A0/A1, or unit tests exercising this module in
 * isolation), never substituted for the real adapter in the A3 causal
 * condition.
 */
export const PASSTHROUGH_TOOL_HEURISTICS: ToolHeuristicHooks = {
  shouldSearch: () => ({
    action: "SEARCH",
    reason: "no learned heuristic installed; default policy always searches",
  }),
  isHighConfidenceSufficient: () => ({
    action: "SEARCH",
    reason: "no learned heuristic installed; confidence gating not implemented by this layer",
  }),
  isFurtherSearchUnlikelyToHelp: () => ({
    action: "SEARCH",
    reason: "no learned heuristic installed; diminishing-returns gating not implemented by this layer",
  }),
  shouldAbstainOrEscalate: () => ({
    action: "SEARCH",
    reason: "no learned heuristic installed; abstain/escalate gating not implemented by this layer",
  }),
};

export interface ToolHeuristicEvaluation {
  readonly shouldSearch: ToolHeuristicDecision;
  readonly isHighConfidenceSufficient: ToolHeuristicDecision;
  readonly isFurtherSearchUnlikelyToHelp: ToolHeuristicDecision;
  readonly shouldAbstainOrEscalate: ToolHeuristicDecision;
}

/**
 * Runs all four hooks, in a fixed order, against one context and returns
 * each decision labeled by which hook produced it. A simple, order-preserving
 * composition utility — not itself a policy. Combining these four decisions
 * into a single control-flow action is left to the caller (or a future
 * Rulebook-driven controller), since that combination logic is exactly the
 * kind of learned heuristic this layer must not invent.
 */
export function evaluateToolHeuristics(
  hooks: ToolHeuristicHooks,
  ctx: ToolHeuristicContext,
): ToolHeuristicEvaluation {
  return {
    shouldSearch: hooks.shouldSearch(ctx),
    isHighConfidenceSufficient: hooks.isHighConfidenceSufficient(ctx),
    isFurtherSearchUnlikelyToHelp: hooks.isFurtherSearchUnlikelyToHelp(ctx),
    shouldAbstainOrEscalate: hooks.shouldAbstainOrEscalate(ctx),
  };
}
