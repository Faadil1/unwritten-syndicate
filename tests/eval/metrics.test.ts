import { describe, expect, it } from "vitest";
import { evaluate, majorityBaselinePredictions } from "../../src/eval/metrics.js";
import type { GroundTruth, Prediction } from "../../src/contracts/types.js";

function gt(number: number, label: GroundTruth["label"]): GroundTruth {
  return { number, label, subtype: label === "RESOLVED_COMPLETED" ? "COMPLETED" : "NOT_PLANNED", createdAt: "2025-01-01T00:00:00Z" };
}

describe("confusion matrix + metrics", () => {
  // 4 COMPLETED (3 correct, 1 predicted NO_NEW_WORK), 2 NO_NEW_WORK (1 correct, 1 predicted COMPLETED)
  const truth: GroundTruth[] = [
    gt(1, "RESOLVED_COMPLETED"),
    gt(2, "RESOLVED_COMPLETED"),
    gt(3, "RESOLVED_COMPLETED"),
    gt(4, "RESOLVED_COMPLETED"),
    gt(5, "RESOLVED_NO_NEW_WORK"),
    gt(6, "RESOLVED_NO_NEW_WORK"),
  ];
  const predictions: Prediction[] = [
    { number: 1, predicted: "RESOLVED_COMPLETED" },
    { number: 2, predicted: "RESOLVED_COMPLETED" },
    { number: 3, predicted: "RESOLVED_COMPLETED" },
    { number: 4, predicted: "RESOLVED_NO_NEW_WORK" },
    { number: 5, predicted: "RESOLVED_NO_NEW_WORK" },
    { number: 6, predicted: "RESOLVED_COMPLETED" },
  ];

  it("computes accuracy correctly", () => {
    const result = evaluate("DEV", truth, predictions);
    expect(result.accuracy).toBeCloseTo(4 / 6, 10);
  });

  it("computes the confusion matrix correctly", () => {
    const result = evaluate("DEV", truth, predictions);
    // rows/cols order: [RESOLVED_COMPLETED, RESOLVED_NO_NEW_WORK]
    expect(result.confusionMatrix.matrix).toEqual([
      [3, 1],
      [1, 1],
    ]);
  });

  it("computes per-class precision/recall/F1 correctly", () => {
    const result = evaluate("DEV", truth, predictions);
    const completed = result.perClass.find((c) => c.label === "RESOLVED_COMPLETED")!;
    // TP=3, FP=1 (from row2 col1), FN=1 -> precision 3/4, recall 3/4, f1 0.75
    expect(completed.precision).toBeCloseTo(0.75, 10);
    expect(completed.recall).toBeCloseTo(0.75, 10);
    expect(completed.f1).toBeCloseTo(0.75, 10);

    const noNewWork = result.perClass.find((c) => c.label === "RESOLVED_NO_NEW_WORK")!;
    // TP=1, FP=1, FN=1 -> precision 0.5, recall 0.5, f1 0.5
    expect(noNewWork.precision).toBeCloseTo(0.5, 10);
    expect(noNewWork.recall).toBeCloseTo(0.5, 10);
    expect(noNewWork.f1).toBeCloseTo(0.5, 10);
  });

  it("computes macro-F1 as the mean of per-class F1", () => {
    const result = evaluate("DEV", truth, predictions);
    expect(result.macroF1).toBeCloseTo((0.75 + 0.5) / 2, 10);
  });

  it("handles the zero-recall majority-baseline case (F1=0 for missing class)", () => {
    const majority = majorityBaselinePredictions(truth, "RESOLVED_COMPLETED");
    const result = evaluate("DEV", truth, majority);
    const noNewWork = result.perClass.find((c) => c.label === "RESOLVED_NO_NEW_WORK")!;
    expect(noNewWork.recall).toBe(0);
    expect(noNewWork.f1).toBe(0);
  });

  it("accounts for errored predictions separately from scored ones", () => {
    const withError: Prediction[] = [
      ...predictions.slice(0, 5),
      { number: 6, predicted: "RESOLVED_COMPLETED", error: "timeout" },
    ];
    const result = evaluate("DEV", truth, withError);
    expect(result.errored).toBe(1);
    expect(result.scored).toBe(5);
    expect(result.totalRecords).toBe(6);
  });

  it("throws if a ground-truth record has no corresponding prediction", () => {
    expect(() => evaluate("DEV", truth, predictions.slice(0, 5))).toThrow(/Missing/);
  });
});
