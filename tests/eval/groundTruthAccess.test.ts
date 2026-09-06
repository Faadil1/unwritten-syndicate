import { describe, expect, it } from "vitest";
import { loadEvaluatorGroundTruth, requestEvaluatorAccess } from "../../src/eval/groundTruthAccess.js";

describe("FINAL_HOLDOUT ground truth is evaluator-only", () => {
  it("throws when FINAL_HOLDOUT is requested without an access token", () => {
    expect(() => loadEvaluatorGroundTruth("FINAL_HOLDOUT")).toThrow(/EvaluatorAccessToken/);
  });

  it("throws when requestEvaluatorAccess is called without the exact acknowledgment", () => {
    expect(() => requestEvaluatorAccess("I promise")).toThrow(/denied/i);
  });

  it("allows FINAL_HOLDOUT access with a properly acknowledged token", () => {
    const token = requestEvaluatorAccess(
      "I am the evaluator and will not expose this ground truth to any predictor, rule-learning worker, or tool-policy worker.",
    );
    const truth = loadEvaluatorGroundTruth("FINAL_HOLDOUT", token);
    expect(truth).toHaveLength(88);
  });

  it("allows TRAIN/DEV without any token", () => {
    expect(loadEvaluatorGroundTruth("TRAIN")).toHaveLength(206);
    expect(loadEvaluatorGroundTruth("DEV")).toHaveLength(66);
  });
});
