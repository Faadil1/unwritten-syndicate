import { describe, expect, it } from "vitest";
import {
  CONTRADICTION_RETIRE_THRESHOLD,
  MAX_ACTIVE_RULES,
  Rulebook,
  computeConfidence,
} from "../../src/rulebook/rulebook.js";
import type { RuleCondition } from "../../src/rulebook/types.js";

function generateDistinctConditionSets(): RuleCondition[][] {
  const bodyBuckets = ["short", "medium", "long"] as const;
  const titleBuckets = ["short", "medium", "long"] as const;
  const sets: RuleCondition[][] = [];
  for (const b of bodyBuckets) {
    for (const t of titleBuckets) {
      sets.push([
        { feature: "bodyLengthBucket", operator: "equals", value: b },
        { feature: "titleLengthBucket", operator: "equals", value: t },
      ]);
    }
  }
  for (const q of [true, false]) {
    for (const c of [true, false]) {
      sets.push([
        { feature: "hasQuestionMark", operator: q ? "truthy" : "falsy" },
        { feature: "hasCodeBlock", operator: c ? "truthy" : "falsy" },
      ]);
    }
  }
  for (const a of ["NONE", "FIRST_TIME_CONTRIBUTOR", "CONTRIBUTOR"] as const) {
    sets.push([{ feature: "authorAssociation", operator: "equals", value: a }]);
  }
  return sets; // 9 + 4 + 3 = 16 distinct condition sets
}

describe("Rulebook lifecycle", () => {
  it("promotes a candidate to active once support+confidence clear the bar", () => {
    const rb = new Rulebook();
    const rule = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    expect(rule.status).toBe("candidate");
    rb.consolidate(1);
    expect(rb.getById(rule.id)?.status).toBe("active");
  });

  it("rejects proposals whose conditions reference disallowed features (no issue->outcome caching)", () => {
    const rb = new Rulebook();
    const bad = [{ feature: "issueNumber", operator: "equals", value: 42 }] as unknown as RuleCondition[];
    expect(() =>
      rb.proposeCandidate(1, {
        type: "content_shape_signal",
        conditions: bad,
        recommendedBehavior: "RESOLVED_COMPLETED",
        supportCount: 5,
        successCount: 5,
        failureCount: 0,
      }),
    ).toThrow(/disallowed feature/);
  });

  it("merges duplicate (conditions, recommendedBehavior) proposals instead of creating duplicates", () => {
    const rb = new Rulebook();
    const conditions: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }];
    rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions,
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 3,
      successCount: 2,
      failureCount: 1,
    });
    const merged = rb.proposeCandidate(2, {
      type: "authorship_signal",
      conditions,
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 3,
      successCount: 2,
      failureCount: 1,
    });
    expect(rb.getRules()).toHaveLength(1);
    expect(merged.supportCount).toBe(6);
    expect(merged.successCount).toBe(4);
    expect(merged.failureCount).toBe(2);
    expect(merged.confidence).toBeCloseTo(computeConfidence(4, 2));
  });

  it("updates confidence via Laplace-smoothed success rate on recordOutcome", () => {
    const rb = new Rulebook();
    const rule = rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasCodeBlock", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 2,
      successCount: 1,
      failureCount: 1,
    });
    expect(rule.confidence).toBeCloseTo(computeConfidence(1, 1));
    rb.recordOutcome(rule.id, 2, true);
    expect(rb.getById(rule.id)?.confidence).toBeCloseTo(computeConfidence(2, 1));
    rb.recordOutcome(rule.id, 2, false);
    expect(rb.getById(rule.id)?.confidence).toBeCloseTo(computeConfidence(2, 2));
  });

  it("detects contradictions between overlapping active rules with opposite recommendations, retiring both after repeated conflict", () => {
    const rb = new Rulebook();
    const ruleA = rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasQuestionMark", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    const ruleB = rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasQuestionMark", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    rb.consolidate(1); // both promoted to active; first contradiction event recorded
    expect(rb.getById(ruleA.id)?.status).toBe("active");
    expect(rb.getById(ruleA.id)?.contradictionCount).toBe(1);
    expect(rb.getById(ruleB.id)?.contradictionCount).toBe(1);

    expect(CONTRADICTION_RETIRE_THRESHOLD).toBe(2);
    rb.consolidate(2); // second contradiction event -> threshold reached
    expect(rb.getById(ruleA.id)?.status).toBe("contradicted");
    expect(rb.getById(ruleB.id)?.status).toBe("contradicted");
  });

  it("does not contradict rules whose conditions cannot co-fire", () => {
    const rb = new Rulebook();
    const ruleA = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    const ruleB = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    rb.consolidate(1);
    expect(rb.getById(ruleA.id)?.contradictionCount).toBe(0);
    expect(rb.getById(ruleB.id)?.contradictionCount).toBe(0);
    expect(rb.getById(ruleA.id)?.status).toBe("active");
    expect(rb.getById(ruleB.id)?.status).toBe("active");
  });

  it("retires rules whose evidence accumulates a high failure rate", () => {
    const rb = new Rulebook();
    const rule = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    rb.consolidate(1);
    expect(rb.getById(rule.id)?.status).toBe("active");

    for (let i = 0; i < 8; i++) rb.recordOutcome(rule.id, 2, false);
    // support=13, success=5, failure=8 -> failure rate 0.615 >= 0.6 threshold
    const retiredCount = rb.retireFailingRules(2);
    expect(retiredCount).toBe(1);
    expect(rb.getById(rule.id)?.status).toBe("retired");
  });

  it("enforces the MAX_ACTIVE_RULES budget by evicting the weakest rule", () => {
    const rb = new Rulebook();
    const conditionSets = generateDistinctConditionSets();
    expect(conditionSets).toHaveLength(16);

    for (let i = 0; i < 15; i++) {
      rb.proposeCandidate(1, {
        type: "content_shape_signal",
        conditions: conditionSets[i]!,
        recommendedBehavior: "RESOLVED_COMPLETED",
        supportCount: 10,
        successCount: 10,
        failureCount: 0,
      });
    }
    const weak = rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: conditionSets[15]!,
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 3,
      successCount: 3,
      failureCount: 0,
    });

    rb.consolidate(1);
    expect(rb.getRules("active")).toHaveLength(MAX_ACTIVE_RULES);
    expect(rb.getById(weak.id)?.status).toBe("retired");
  });

  it("computes compression metrics (examples_seen, per-status counts, compression_ratio)", () => {
    const rb = new Rulebook();

    const active1 = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    const active2 = rb.proposeCandidate(1, {
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    void active1;
    void active2;
    // candidate: not enough support/confidence to promote
    rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "bodyLengthBucket", operator: "equals", value: "medium" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 3,
      successCount: 2,
      failureCount: 1,
    });
    // retired-by-failure: low confidence, high failure rate
    rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasCodeBlock", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 0,
      failureCount: 5,
    });
    // contradiction pair -> both end up "contradicted" after two consolidations
    const contraA = rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasQuestionMark", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_COMPLETED",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    const contraB = rb.proposeCandidate(1, {
      type: "content_shape_signal",
      conditions: [{ feature: "hasQuestionMark", operator: "truthy" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      supportCount: 5,
      successCount: 5,
      failureCount: 0,
    });

    rb.consolidate(1);
    rb.consolidate(2);
    expect(rb.getById(contraA.id)?.status).toBe("contradicted");
    expect(rb.getById(contraB.id)?.status).toBe("contradicted");

    const metrics = rb.computeMetrics(2, 40);
    expect(metrics.examplesSeen).toBe(40);
    expect(metrics.activeRules).toBe(2);
    expect(metrics.candidateRules).toBe(1);
    expect(metrics.retiredRules).toBe(3); // 1 failed + 2 contradicted
    expect(metrics.compressionRatio).toBeCloseTo(40 / 2);
  });
});
