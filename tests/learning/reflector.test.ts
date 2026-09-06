import { describe, expect, it } from "vitest";
import { Reflector, type RevealedExample } from "../../src/learning/reflector.js";
import type { PredictorInput } from "../../src/contracts/types.js";
import type { Rule } from "../../src/rulebook/types.js";

function makeInput(overrides: Partial<PredictorInput> = {}): PredictorInput {
  return {
    title: "word0 word1 word2 word3",
    body: "x".repeat(50),
    createdAt: "2025-01-01T00:00:00Z",
    authorAssociation: "CONTRIBUTOR",
    ...overrides,
  };
}

function example(number: number, overrides: Partial<RevealedExample> = {}): RevealedExample {
  return {
    number,
    split: "TRAIN",
    input: makeInput(),
    predicted: "RESOLVED_COMPLETED",
    actual: "RESOLVED_COMPLETED",
    ...overrides,
  };
}

describe("Reflector TRAIN-only guard", () => {
  it("throws if any revealed example comes from DEV", () => {
    const reflector = new Reflector();
    const examples = [example(1), example(2, { split: "DEV" })];
    expect(() => reflector.reflect(1, examples, [])).toThrow(/TRAIN feedback/);
  });

  it("throws if any revealed example comes from FINAL_HOLDOUT", () => {
    const reflector = new Reflector();
    const examples = [example(1, { split: "FINAL_HOLDOUT" })];
    expect(() => reflector.reflect(1, examples, [])).toThrow(/DEV and FINAL_HOLDOUT must never update memory/);
  });

  it("accepts an all-TRAIN batch without throwing", () => {
    const reflector = new Reflector();
    const examples = [example(1), example(2)];
    expect(() => reflector.reflect(1, examples, [])).not.toThrow();
  });
});

describe("Reflector.reflect — proposing generalized rules", () => {
  it("proposes a rule when a feature value strongly correlates with an outcome across enough examples", () => {
    const reflector = new Reflector();
    const examples: RevealedExample[] = [
      example(1, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(2, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(3, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(4, { input: makeInput({ authorAssociation: "NONE" }), actual: "RESOLVED_COMPLETED" }),
    ];
    const delta = reflector.reflect(1, examples, []);
    const proposal = delta.proposals.find(
      (p) => p.conditions.length === 1 && p.conditions[0]!.feature === "authorAssociation" && p.conditions[0]!.value === "CONTRIBUTOR",
    );
    expect(proposal).toBeDefined();
    expect(proposal!.recommendedBehavior).toBe("RESOLVED_NO_NEW_WORK");
    expect(proposal!.supportCount).toBe(3);
    expect(proposal!.successCount).toBe(3);
    expect(proposal!.failureCount).toBe(0);
  });

  it("does not propose a rule when support is below the minimum group size", () => {
    const reflector = new Reflector();
    const examples: RevealedExample[] = [
      example(1, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(2, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
    ];
    const delta = reflector.reflect(1, examples, []);
    const proposal = delta.proposals.find((p) => p.conditions[0]!.feature === "authorAssociation");
    expect(proposal).toBeUndefined();
  });

  it("does not propose a rule when the group's outcome is not sufficiently pure", () => {
    const reflector = new Reflector();
    const examples: RevealedExample[] = [
      example(1, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(2, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_COMPLETED" }),
      example(3, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(4, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_COMPLETED" }),
    ];
    const delta = reflector.reflect(1, examples, []);
    const proposal = delta.proposals.find((p) => p.conditions[0]!.feature === "authorAssociation");
    expect(proposal).toBeUndefined(); // purity 0.5 < MIN_GROUP_PURITY
  });

  it("never leaks raw issue identity/content into a proposal — only abstracted feature conditions and aggregate counts", () => {
    const reflector = new Reflector();
    const examples: RevealedExample[] = [
      example(101, {
        input: makeInput({ authorAssociation: "CONTRIBUTOR", body: "UNIQUE_MARKER_XYZ ".repeat(3) }),
        actual: "RESOLVED_NO_NEW_WORK",
      }),
      example(202, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(303, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
    ];
    const delta = reflector.reflect(1, examples, []);
    const serialized = JSON.stringify(delta.proposals);
    expect(serialized).not.toContain("UNIQUE_MARKER_XYZ");
    expect(serialized).not.toMatch(/\b101\b|\b202\b|\b303\b/);
    for (const p of delta.proposals) {
      for (const c of p.conditions) {
        expect(["authorAssociation", "bodyLengthBucket", "titleLengthBucket", "hasQuestionMark", "hasCodeBlock"]).toContain(
          c.feature,
        );
      }
    }
  });

  it("does not regenerate a proposal for a (conditions, behavior) pair already backed by an active rule (avoids double-counting evidence already captured via scoreActiveRules)", () => {
    const reflector = new Reflector();
    const activeRule: Rule = {
      id: "r1",
      type: "authorship_signal",
      conditions: [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }],
      recommendedBehavior: "RESOLVED_NO_NEW_WORK",
      confidence: 0.8,
      supportCount: 8,
      successCount: 6,
      failureCount: 2,
      contradictionCount: 0,
      createdRound: 1,
      updatedRound: 1,
      status: "active",
    };
    const examples: RevealedExample[] = [
      example(1, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(2, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
      example(3, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }),
    ];
    const delta = reflector.reflect(2, examples, [activeRule]);
    const duplicateProposal = delta.proposals.find(
      (p) =>
        p.conditions.length === 1 &&
        p.conditions[0]!.feature === "authorAssociation" &&
        p.conditions[0]!.value === "CONTRIBUTOR" &&
        p.recommendedBehavior === "RESOLVED_NO_NEW_WORK",
    );
    expect(duplicateProposal).toBeUndefined();
    // the evidence is still captured, exactly once, via outcomeRecords against the existing active rule
    expect(delta.outcomeRecords.filter((r) => r.ruleId === "r1")).toHaveLength(3);
  });
});

describe("Reflector.reflect — scoring existing active rules", () => {
  it("records a success/failure outcome for every active rule that fires on a revealed example", () => {
    const reflector = new Reflector();
    const activeRules: Rule[] = [
      {
        id: "r1",
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
      },
    ];
    const examples: RevealedExample[] = [
      example(1, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_NO_NEW_WORK" }), // matches rule, success
      example(2, { input: makeInput({ authorAssociation: "CONTRIBUTOR" }), actual: "RESOLVED_COMPLETED" }), // matches rule, failure
      example(3, { input: makeInput({ authorAssociation: "NONE" }), actual: "RESOLVED_COMPLETED" }), // does not match
    ];
    const delta = reflector.reflect(1, examples, activeRules);
    expect(delta.outcomeRecords).toHaveLength(2);
    expect(delta.outcomeRecords.filter((r) => r.success)).toHaveLength(1);
    expect(delta.outcomeRecords.filter((r) => !r.success)).toHaveLength(1);
    expect(delta.examplesConsidered).toBe(3);
  });
});
