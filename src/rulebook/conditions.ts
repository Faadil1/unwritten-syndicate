import { CONDITION_FEATURES, type FeatureVector, type RuleCondition } from "./types.js";

/** Evaluates a single condition against a feature vector. */
export function matchesCondition(features: FeatureVector, condition: RuleCondition): boolean {
  const actual = features[condition.feature];
  switch (condition.operator) {
    case "equals":
      return actual === condition.value;
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "gte":
      return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "lte":
      return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
  }
}

/** A rule fires only if ALL of its conditions match (conjunctive). */
export function matchesAllConditions(features: FeatureVector, conditions: readonly RuleCondition[]): boolean {
  return conditions.every((c) => matchesCondition(features, c));
}

/** Order-independent signature used for equality/grouping. */
export function conditionsSignature(conditions: readonly RuleCondition[]): string {
  return [...conditions]
    .map((c) => `${c.feature}:${c.operator}:${String(c.value)}`)
    .sort()
    .join(",");
}

export function conditionsEqual(a: readonly RuleCondition[], b: readonly RuleCondition[]): boolean {
  return conditionsSignature(a) === conditionsSignature(b);
}

/**
 * Two same-feature constraints are compatible if some feature value could
 * satisfy both simultaneously. Used to decide whether two rules' condition
 * sets could ever both fire on the same example (a prerequisite for treating
 * opposing recommendations as a real contradiction rather than two rules
 * that simply never co-fire).
 */
function compatiblePair(a: RuleCondition, b: RuleCondition): boolean {
  if (a.feature !== b.feature) return true;
  if (a.operator === "equals" && b.operator === "equals") return a.value === b.value;
  if (a.operator === "truthy" && b.operator === "falsy") return false;
  if (a.operator === "falsy" && b.operator === "truthy") return false;
  if (a.operator === "equals" && b.operator === "truthy") return Boolean(a.value);
  if (a.operator === "equals" && b.operator === "falsy") return !a.value;
  if (b.operator === "equals" && a.operator === "truthy") return Boolean(b.value);
  if (b.operator === "equals" && a.operator === "falsy") return !b.value;
  // gte/lte numeric-range combinations: no cheap decisive check available here,
  // so treat as compatible (conservative — avoids manufacturing false contradictions).
  return true;
}

/**
 * Whether two rules make compatible-or-conflicting claims about the SAME
 * condition dimension. Requires at least one shared feature between the two
 * condition sets (rules on entirely disjoint features are orthogonal — both
 * may fire together without that being a logical conflict, it's just normal
 * multi-rule voting) AND every shared-feature constraint pair must be
 * mutually satisfiable. Used for contradiction detection: two active rules
 * whose claims overlap on a shared dimension but which recommend opposite
 * behavior are a genuine policy conflict.
 */
export function conditionsOverlap(a: readonly RuleCondition[], b: readonly RuleCondition[]): boolean {
  const sharesFeature = a.some((ca) => b.some((cb) => cb.feature === ca.feature));
  if (!sharesFeature) return false;
  for (const ca of a) {
    for (const cb of b) {
      if (ca.feature === cb.feature && !compatiblePair(ca, cb)) return false;
    }
  }
  return true;
}

/**
 * Structural guardrail against issue->outcome memorization: throws unless
 * every condition's feature is in the closed abstraction vocabulary, and
 * unless there is at least one condition (an unconditional rule would be
 * indistinguishable from "always predict X for this specific case").
 */
export function validateConditions(conditions: readonly RuleCondition[]): void {
  if (conditions.length === 0) {
    throw new Error(
      "A rule must have at least one condition — an unconditional rule cannot abstract across experiences.",
    );
  }
  for (const c of conditions) {
    if (!(CONDITION_FEATURES as readonly string[]).includes(c.feature)) {
      throw new Error(
        `Rule condition references disallowed feature "${c.feature}". Only abstracted features ` +
          `(${CONDITION_FEATURES.join(", ")}) may be used — raw issue identity/content fields ` +
          `(number, title, body) must never appear in a policy rule's conditions.`,
      );
    }
  }
}
