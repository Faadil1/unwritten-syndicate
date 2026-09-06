import { describe, expect, it } from "vitest";
import { deterministicShuffle, scrambleRulebook } from "../../src/eval/permutation.js";
import type { RulebookSnapshot } from "../../src/contracts/types.js";

describe("deterministic scrambled permutation", () => {
  it("same seed produces the same shuffle order every time", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = deterministicShuffle(items, "seed-A");
    const b = deterministicShuffle(items, "seed-A");
    expect(a).toEqual(b);
  });

  it("different seeds produce different shuffle orders (with high probability)", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = deterministicShuffle(items, "seed-A");
    const b = deterministicShuffle(items, "seed-B");
    expect(a).not.toEqual(b);
  });

  it("shuffle is a permutation (same multiset of elements)", () => {
    const items = [1, 2, 3, 4, 5];
    const shuffled = deterministicShuffle(items, "seed-X");
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("does not mutate the input array", () => {
    const items = [1, 2, 3];
    const copy = [...items];
    deterministicShuffle(items, "seed");
    expect(items).toEqual(copy);
  });
});

describe("A2 scrambled rulebook", () => {
  const rulebook: RulebookSnapshot = {
    version: "V3",
    rules: [
      { id: "r1", recommendedBehavior: "behavior-1", rationale: "why-1" },
      { id: "r2", recommendedBehavior: "behavior-2", rationale: "why-2" },
      { id: "r3", recommendedBehavior: "behavior-3", rationale: "why-3" },
      { id: "r4", recommendedBehavior: "behavior-4", rationale: "why-4" },
    ],
  };

  it("preserves rule count and ids", () => {
    const scrambled = scrambleRulebook(rulebook, "fixed-seed");
    expect(scrambled.rules.map((r) => r.id)).toEqual(rulebook.rules.map((r) => r.id));
  });

  it("permutes recommendedBehavior deterministically for a fixed seed", () => {
    const a = scrambleRulebook(rulebook, "fixed-seed");
    const b = scrambleRulebook(rulebook, "fixed-seed");
    expect(a).toEqual(b);
  });

  it("recommendedBehavior set is unchanged, only reordered", () => {
    const scrambled = scrambleRulebook(rulebook, "fixed-seed");
    const originalBehaviors = rulebook.rules.map((r) => r.recommendedBehavior).sort();
    const scrambledBehaviors = scrambled.rules.map((r) => r.recommendedBehavior).sort();
    expect(scrambledBehaviors).toEqual(originalBehaviors);
  });
});
