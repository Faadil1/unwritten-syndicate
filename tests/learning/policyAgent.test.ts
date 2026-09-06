import { describe, expect, it } from "vitest";
import { RuleBasedPolicyAgent } from "../../src/learning/policyAgent.js";
import type { PredictorInput } from "../../src/contracts/types.js";
import type { Rule } from "../../src/rulebook/types.js";

function input(overrides: Partial<PredictorInput> = {}): PredictorInput {
  return {
    title: "word0 word1 word2?",
    body: "x".repeat(50),
    createdAt: "2025-01-01T00:00:00Z",
    authorAssociation: "CONTRIBUTOR",
    ...overrides,
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: "rule-1",
    type: "authorship_signal",
    conditions: [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }],
    recommendedBehavior: "RESOLVED_NO_NEW_WORK",
    confidence: 0.8,
    supportCount: 5,
    successCount: 4,
    failureCount: 1,
    contradictionCount: 0,
    createdRound: 1,
    updatedRound: 1,
    status: "active",
    ...overrides,
  };
}

describe("RuleBasedPolicyAgent", () => {
  it("falls back to the fixed default prior when no active rule fires", () => {
    const agent = new RuleBasedPolicyAgent();
    const decision = agent.predict(input({ authorAssociation: "NONE" }), [
      rule({ conditions: [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }] }),
    ]);
    expect(decision.predicted).toBe("RESOLVED_COMPLETED");
    expect(decision.firedRuleIds).toEqual([]);
    expect(decision.confidence).toBe(0);
  });

  it("picks the higher-weighted (confidence * supportCount) side among firing rules", () => {
    const agent = new RuleBasedPolicyAgent();
    const strong = rule({
      id: "strong",
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      confidence: 0.9,
      supportCount: 10, // weight 9.0
    });
    const weak = rule({
      id: "weak",
      recommendedBehavior: "RESOLVED_COMPLETED",
      confidence: 0.6,
      supportCount: 3, // weight 1.8
    });
    const decision = agent.predict(input(), [strong, weak]);
    expect(decision.predicted).toBe("RESOLVED_NO_NEW_WORK");
    expect([...decision.firedRuleIds].sort()).toEqual(["strong", "weak"]);
    expect(decision.confidence).toBeCloseTo(9.0 / (9.0 + 1.8));
  });

  it("is deterministic across repeated calls with the same input and rules", () => {
    const agent = new RuleBasedPolicyAgent();
    const rules = [rule({})];
    const first = agent.predict(input(), rules);
    const second = agent.predict(input(), rules);
    expect(second).toEqual(first);
  });

  it("only counts rules whose conditions actually match the input's feature vector", () => {
    const agent = new RuleBasedPolicyAgent();
    const nonMatching = rule({
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
    });
    const decision = agent.predict(input({ authorAssociation: "CONTRIBUTOR" }), [nonMatching]);
    expect(decision.firedRuleIds).toEqual([]);
    expect(decision.predicted).toBe("RESOLVED_COMPLETED");
  });
});
