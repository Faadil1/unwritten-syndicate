import type {
  GroundTruth,
  HistoricalRecord,
  PredictorInput,
  Prediction,
  ResolutionDisposition,
  RulebookSnapshot,
  SplitName,
} from "../contracts/types.js";
import { HistoricalRecordStore } from "../data/historicalRecords.js";
import type { Rule } from "../rulebook/types.js";
import type { ToolHeuristicContext, ToolHeuristicHooks } from "../tools/toolHeuristics.js";
import { scrambleRulebook } from "./permutation.js";

/**
 * A predictor is any function that maps a PredictorInput to a disposition
 * (or throws/rejects, captured as a Prediction.error). This is the ONLY
 * signature every baseline (A0/A1/A2/A3) must implement — it structurally
 * enforces the hard input boundary, since a predictor never receives
 * anything but a PredictorInput.
 */
export type Predictor = (input: PredictorInput) => Promise<ResolutionDisposition> | ResolutionDisposition;

export interface EvalItem {
  readonly number: number;
  readonly input: PredictorInput;
}

/**
 * Evaluation isolation: runs a predictor over a list of items with no
 * shared mutable state between calls (each call gets its own try/catch,
 * predictors are called with a frozen copy of their input, and a failure
 * on one item cannot corrupt or block scoring of any other item).
 */
export async function runPredictor(
  predictor: Predictor,
  items: readonly EvalItem[],
): Promise<Prediction[]> {
  const predictions: Prediction[] = [];
  for (const item of items) {
    const isolatedInput: PredictorInput = Object.freeze({ ...item.input });
    try {
      const predicted = await predictor(isolatedInput);
      predictions.push({ number: item.number, predicted });
    } catch (err) {
      predictions.push({
        number: item.number,
        predicted: "RESOLVED_COMPLETED", // placeholder value; `error` marks this unscored
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return predictions;
}

/**
 * A0: canonical cold-evaluation harness. The predictor sees ONLY
 * PredictorInput — no historical records, no rulebook. This is the
 * baseline every other arm (A1/A2/A3) must be compared against, and the
 * one Gate 01C's Orchestrator hardness-probe score must NOT be reused as
 * (see PROJECT_SPEC.md "BASELINES").
 */
export async function runA0Cold(predictor: Predictor, items: readonly EvalItem[]): Promise<Prediction[]> {
  return runPredictor(predictor, items);
}

/**
 * A1: raw-RAG baseline plumbing. Wraps a base predictor so it additionally
 * receives up to `topK` raw historical resolved examples (no synthesized
 * rulebook), fetched from `store` under the temporal search contract. The
 * `withHistory` callback is responsible for actually using the examples
 * (e.g. building a longer prompt) — this function only wires the plumbing
 * and enforces isolation/temporal safety, since a fixed Predictor signature
 * cannot itself carry history.
 */
export function makeA1Predictor(
  store: HistoricalRecordStore,
  topK: number,
  withHistory: (input: PredictorInput, history: readonly HistoricalRecord[]) => Promise<ResolutionDisposition> | ResolutionDisposition,
): Predictor {
  return (input: PredictorInput) => {
    const history = store.findRecentPast(input.createdAt, topK);
    return withHistory(input, history);
  };
}

/**
 * A2: scrambled-rulebook baseline plumbing. Wraps a base predictor so it
 * receives a deterministically-permuted V3 rulebook (same shape/size as the
 * real one, recommended behaviors shuffled) instead of the real Rulebook.
 * `seed` must be fixed per run for reproducibility (see permutation.ts).
 */
export function makeA2Predictor(
  rulebook: RulebookSnapshot,
  seed: string,
  withRulebook: (input: PredictorInput, scrambled: RulebookSnapshot) => Promise<ResolutionDisposition> | ResolutionDisposition,
): Predictor {
  const scrambled = scrambleRulebook(rulebook, seed);
  return (input: PredictorInput) => withRulebook(input, scrambled);
}

/**
 * A3: actual learned V3 Rulebook baseline plumbing. Structurally parallel to
 * `makeA1Predictor` — same `store`/`topK` triple, same temporal contract, so
 * the ONLY thing that can differ between A1 and A3 is what this function
 * adds: Rulebook-driven gating (via `heuristics`, see
 * src/rulebook/toolHeuristicAdapter.ts) of whether a search is even issued,
 * plus handing the active rules themselves to `withPolicy`. `activeRules`
 * must come from the same frozen V3 snapshot as `heuristics` was built from
 * (see scripts/eval-dev-bakeoff.ts) — this function does not itself load or
 * validate that pairing.
 */
export function makeA3Predictor(
  store: HistoricalRecordStore,
  topK: number,
  activeRules: readonly Rule[],
  heuristics: ToolHeuristicHooks,
  withPolicy: (
    input: PredictorInput,
    activeRules: readonly Rule[],
    history: readonly HistoricalRecord[],
  ) => Promise<ResolutionDisposition> | ResolutionDisposition,
): Predictor {
  return (input: PredictorInput) => {
    const ctx: ToolHeuristicContext = {
      input,
      searchesPerformedSoFar: 0,
      lastResultCount: null,
      currentConfidence: null,
    };
    const decision = heuristics.shouldSearch(ctx);
    const history = decision.action === "SEARCH" ? store.findRecentPast(input.createdAt, topK) : [];
    return withPolicy(input, activeRules, history);
  };
}

export interface SplitDataset {
  readonly split: SplitName;
  readonly groundTruth: readonly GroundTruth[];
  readonly items: readonly EvalItem[];
}
