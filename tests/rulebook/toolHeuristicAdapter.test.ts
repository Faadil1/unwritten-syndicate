import { describe, expect, it } from "vitest";
import { createRulebookToolHeuristics } from "../../src/rulebook/toolHeuristicAdapter.js";
import type { Rule } from "../../src/rulebook/types.js";
import type { PredictorInput } from "../../src/contracts/types.js";
import type { ToolHeuristicContext } from "../../src/tools/toolHeuristics.js";

function baseInput(overrides: Partial<PredictorInput> = {}): PredictorInput {
  return {
    title: "short title",
    body: "x".repeat(900), // "long" bodyLengthBucket
    createdAt: "2025-06-01T00:00:00Z",
    authorAssociation: "NONE",
    ...overrides,
  };
}

function ctx(overrides: Partial<ToolHeuristicContext> = {}): ToolHeuristicContext {
  return {
    input: baseInput(),
    searchesPerformedSoFar: 0,
    lastResultCount: null,
    currentConfidence: null,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    type: "authorship_signal",
    conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
    recommendedBehavior: "RESOLVED_COMPLETED",
    confidence: 0.9,
    supportCount: 10,
    successCount: 9,
    failureCount: 1,
    contradictionCount: 0,
    createdRound: 1,
    updatedRound: 1,
    status: "active",
    ...overrides,
  };
}

describe("createRulebookToolHeuristics", () => {
  it("shouldSearch defers to HIGH_CONFIDENCE_SUFFICIENT when a high-confidence, well-supported active rule matches", () => {
    const hooks = createRulebookToolHeuristics([rule()]);
    const decision = hooks.shouldSearch(ctx());
    expect(decision.action).toBe("HIGH_CONFIDENCE_SUFFICIENT");
    expect(decision.reason).toContain("rule-1");
  });

  it("shouldSearch returns SEARCH when no active rule matches the input's features", () => {
    const hooks = createRulebookToolHeuristics([
      rule({ conditions: [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }] }),
    ]);
    expect(hooks.shouldSearch(ctx()).action).toBe("SEARCH");
  });

  it("shouldSearch returns SEARCH when the matching rule's confidence is below threshold", () => {
    const hooks = createRulebookToolHeuristics([rule({ confidence: 0.5 })]);
    expect(hooks.shouldSearch(ctx()).action).toBe("SEARCH");
  });

  it("shouldSearch returns SEARCH when the matching rule lacks sufficient support despite high confidence", () => {
    const hooks = createRulebookToolHeuristics([rule({ confidence: 0.95, supportCount: 1 })]);
    expect(hooks.shouldSearch(ctx()).action).toBe("SEARCH");
  });

  it("isHighConfidenceSufficient mirrors shouldSearch's high-confidence gate", () => {
    const hooks = createRulebookToolHeuristics([rule()]);
    expect(hooks.isHighConfidenceSufficient(ctx()).action).toBe("HIGH_CONFIDENCE_SUFFICIENT");
  });

  it("isFurtherSearchUnlikelyToHelp fires once the fixed search budget (1) is exhausted", () => {
    const hooks = createRulebookToolHeuristics([]);
    expect(hooks.isFurtherSearchUnlikelyToHelp(ctx({ searchesPerformedSoFar: 0 })).action).toBe("SEARCH");
    expect(hooks.isFurtherSearchUnlikelyToHelp(ctx({ searchesPerformedSoFar: 1 })).action).toBe(
      "FURTHER_SEARCH_UNLIKELY_TO_HELP",
    );
  });

  it("shouldAbstainOrEscalate fires only with no matching rule, exhausted search budget, and zero results", () => {
    const hooks = createRulebookToolHeuristics([]);
    expect(
      hooks.shouldAbstainOrEscalate(ctx({ searchesPerformedSoFar: 1, lastResultCount: 0 })).action,
    ).toBe("ABSTAIN_OR_ESCALATE");
    expect(
      hooks.shouldAbstainOrEscalate(ctx({ searchesPerformedSoFar: 1, lastResultCount: 3 })).action,
    ).toBe("SEARCH");
  });

  it("trusts the caller's rule list rather than re-filtering by status (caller must pass Rulebook.getRules(\"active\"))", () => {
    const hooks = createRulebookToolHeuristics([rule({ status: "candidate" })]);
    expect(hooks.shouldSearch(ctx()).action).toBe("HIGH_CONFIDENCE_SUFFICIENT");
  });
});
