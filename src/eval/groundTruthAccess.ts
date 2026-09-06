import type { GroundTruth, SplitName } from "../contracts/types.js";
import { loadGroundTruth } from "../data/manifests.js";

/**
 * Explicit capability token. A caller must construct one of these (by
 * calling `requestEvaluatorAccess` with an explicit acknowledgment string)
 * before FINAL_HOLDOUT ground truth will be handed back. This makes
 * "I am the evaluator, not a predictor or a rule-learning worker" an
 * explicit, auditable call site rather than an implicit assumption.
 */
export interface EvaluatorAccessToken {
  readonly __brand: "EvaluatorAccessToken";
}

const REQUIRED_ACK =
  "I am the evaluator and will not expose this ground truth to any predictor, rule-learning worker, or tool-policy worker.";

export function requestEvaluatorAccess(acknowledgment: string): EvaluatorAccessToken {
  if (acknowledgment !== REQUIRED_ACK) {
    throw new Error(
      "Evaluator access denied: caller did not provide the exact required acknowledgment string.",
    );
  }
  return { __brand: "EvaluatorAccessToken" };
}

/**
 * Evaluator-only ground-truth loader. TRAIN/DEV truth is handed back freely
 * (needed for cold-baseline scoring, DEV iteration). FINAL_HOLDOUT truth
 * additionally requires an EvaluatorAccessToken, and callers must never
 * route FINAL_HOLDOUT truth into anything a predictor, rule-learner, or
 * tool-policy worker can observe. See EVAL_CONTRACT.md §13, PROJECT_SPEC.md.
 */
export function loadEvaluatorGroundTruth(
  split: SplitName,
  token?: EvaluatorAccessToken,
): readonly GroundTruth[] {
  if (split === "FINAL_HOLDOUT" && !token) {
    throw new Error(
      "FINAL_HOLDOUT ground truth requires an EvaluatorAccessToken (call requestEvaluatorAccess first). " +
        "This gate must not run inference or inspect performance against FINAL_HOLDOUT.",
    );
  }
  return loadGroundTruth(split);
}
