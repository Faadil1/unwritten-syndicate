import { describe, expect, it } from "vitest";
import {
  conditionsEqual,
  conditionsOverlap,
  matchesAllConditions,
  matchesCondition,
  validateConditions,
} from "../../src/rulebook/conditions.js";
import type { FeatureVector, RuleCondition } from "../../src/rulebook/types.js";

const features: FeatureVector = {
  authorAssociation: "CONTRIBUTOR",
  bodyLengthBucket: "short",
  titleLengthBucket: "medium",
  hasQuestionMark: true,
  hasCodeBlock: false,
};

describe("matchesCondition", () => {
  it("equals matches exact value", () => {
    expect(matchesCondition(features, { feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" })).toBe(true);
    expect(matchesCondition(features, { feature: "authorAssociation", operator: "equals", value: "NONE" })).toBe(false);
  });

  it("truthy/falsy match boolean features", () => {
    expect(matchesCondition(features, { feature: "hasQuestionMark", operator: "truthy" })).toBe(true);
    expect(matchesCondition(features, { feature: "hasCodeBlock", operator: "falsy" })).toBe(true);
    expect(matchesCondition(features, { feature: "hasCodeBlock", operator: "truthy" })).toBe(false);
  });
});

describe("matchesAllConditions", () => {
  it("requires every condition to match (conjunctive)", () => {
    const conditions: RuleCondition[] = [
      { feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" },
      { feature: "hasQuestionMark", operator: "truthy" },
    ];
    expect(matchesAllConditions(features, conditions)).toBe(true);
    expect(matchesAllConditions(features, [...conditions, { feature: "hasCodeBlock", operator: "truthy" }])).toBe(false);
  });
});

describe("conditionsEqual", () => {
  it("is order-independent", () => {
    const a: RuleCondition[] = [
      { feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" },
      { feature: "hasQuestionMark", operator: "truthy" },
    ];
    const b: RuleCondition[] = [
      { feature: "hasQuestionMark", operator: "truthy" },
      { feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" },
    ];
    expect(conditionsEqual(a, b)).toBe(true);
  });

  it("differs on differing values", () => {
    const a: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }];
    const b: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "NONE" }];
    expect(conditionsEqual(a, b)).toBe(false);
  });
});

describe("conditionsOverlap", () => {
  it("disjoint feature sets are not treated as overlapping (orthogonal dimensions, not a logical conflict)", () => {
    const a: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }];
    const b: RuleCondition[] = [{ feature: "hasQuestionMark", operator: "truthy" }];
    expect(conditionsOverlap(a, b)).toBe(false);
  });

  it("same feature, incompatible equals values — cannot overlap", () => {
    const a: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }];
    const b: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "NONE" }];
    expect(conditionsOverlap(a, b)).toBe(false);
  });

  it("truthy vs falsy on the same feature cannot overlap", () => {
    const a: RuleCondition[] = [{ feature: "hasQuestionMark", operator: "truthy" }];
    const b: RuleCondition[] = [{ feature: "hasQuestionMark", operator: "falsy" }];
    expect(conditionsOverlap(a, b)).toBe(false);
  });

  it("identical conditions overlap with themselves", () => {
    const a: RuleCondition[] = [{ feature: "authorAssociation", operator: "equals", value: "CONTRIBUTOR" }];
    expect(conditionsOverlap(a, a)).toBe(true);
  });
});

describe("validateConditions", () => {
  it("rejects empty condition lists", () => {
    expect(() => validateConditions([])).toThrow(/at least one condition/);
  });

  it("rejects disallowed/raw-identity features", () => {
    const bad = [{ feature: "issueNumber", operator: "equals", value: 1234 }] as unknown as RuleCondition[];
    expect(() => validateConditions(bad)).toThrow(/disallowed feature/);
  });

  it("accepts conditions using only the closed feature vocabulary", () => {
    expect(() => validateConditions([{ feature: "authorAssociation", operator: "equals", value: "NONE" }])).not.toThrow();
  });
});
