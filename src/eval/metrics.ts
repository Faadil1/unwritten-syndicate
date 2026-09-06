import type {
  EvaluationResult,
  GroundTruth,
  PerClassMetric,
  Prediction,
  ResolutionDisposition,
  SplitName,
} from "../contracts/types.js";

const LABELS: readonly ResolutionDisposition[] = ["RESOLVED_COMPLETED", "RESOLVED_NO_NEW_WORK"];

function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Computes the full evaluation result for a split: confusion matrix,
 * per-class precision/recall/F1, macro-F1, accuracy, and completion/error
 * accounting (predictions that errored instead of returning a label are
 * excluded from scoring but counted separately, never silently dropped).
 */
export function evaluate(
  split: SplitName,
  groundTruth: readonly GroundTruth[],
  predictions: readonly Prediction[],
): EvaluationResult {
  const truthByNumber = new Map(groundTruth.map((g) => [g.number, g]));
  const predByNumber = new Map(predictions.map((p) => [p.number, p]));

  const missing = groundTruth.filter((g) => !predByNumber.has(g.number));
  if (missing.length > 0) {
    throw new Error(
      `evaluate() requires a prediction (possibly errored) for every ground-truth record. ` +
        `Missing: ${missing.map((m) => m.number).join(", ")}`,
    );
  }

  const errored = predictions.filter((p) => p.error !== undefined);
  const scoredPairs = predictions
    .filter((p) => p.error === undefined)
    .map((p) => {
      const truth = truthByNumber.get(p.number);
      if (!truth) {
        throw new Error(`Prediction for unknown issue number ${p.number} (not in ground truth)`);
      }
      return { truth: truth.label, predicted: p.predicted };
    });

  const labelIndex = new Map(LABELS.map((l, i) => [l, i]));
  const matrix: number[][] = LABELS.map(() => LABELS.map(() => 0));
  for (const { truth, predicted } of scoredPairs) {
    const r = labelIndex.get(truth);
    const c = labelIndex.get(predicted);
    if (r === undefined || c === undefined) {
      throw new Error(`Unknown label encountered: truth=${truth} predicted=${predicted}`);
    }
    matrix[r]![c]! += 1;
  }

  const perClass: PerClassMetric[] = LABELS.map((label, i) => {
    const support = matrix[i]!.reduce((s, v) => s + v, 0);
    const truePositive = matrix[i]![i]!;
    const predictedPositive = matrix.reduce((s, row) => s + row[i]!, 0);
    const precision = safeDiv(truePositive, predictedPositive);
    const recall = safeDiv(truePositive, support);
    const f1 = safeDiv(2 * precision * recall, precision + recall);
    return { label, support, precision, recall, f1 };
  });

  const macroF1 = safeDiv(
    perClass.reduce((s, c) => s + c.f1, 0),
    perClass.length,
  );

  const correct = scoredPairs.filter((p) => p.truth === p.predicted).length;
  const accuracy = safeDiv(correct, scoredPairs.length);

  return {
    split,
    totalRecords: groundTruth.length,
    scored: scoredPairs.length,
    errored: errored.length,
    accuracy,
    macroF1,
    perClass,
    confusionMatrix: { labels: LABELS, matrix },
  };
}

/** Convenience: builds the majority-class baseline predictions for a split. */
export function majorityBaselinePredictions(
  groundTruth: readonly GroundTruth[],
  majorityLabel: ResolutionDisposition = "RESOLVED_COMPLETED",
): Prediction[] {
  return groundTruth.map((g) => ({ number: g.number, predicted: majorityLabel }));
}
