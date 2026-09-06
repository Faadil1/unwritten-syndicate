import { createHash } from "node:crypto";
import type { PolicyRule, RulebookSnapshot } from "../contracts/types.js";

/** Deterministic PRNG (mulberry32), seeded from a string via SHA-256. */
function seedFromString(seed: string): number {
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffles an array given a fixed string seed, using
 * Fisher-Yates with a seeded PRNG. Same input array + same seed always
 * produces the same output order — required for A2 reproducibility.
 */
export function deterministicShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = mulberry32(seedFromString(seed));
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * A2 baseline plumbing: produces a scrambled-rulebook variant of a V3
 * Rulebook snapshot by deterministically permuting the recommended-behavior
 * text across rules, while keeping rule ids/rationale and overall structure
 * (rule count, approximate context size) unchanged. This isolates "does
 * having a plausible-but-scrambled rulebook shape help" from "does having
 * the actually-correct rulebook content help" — see PROJECT_SPEC.md A2.
 */
export function scrambleRulebook(rulebook: RulebookSnapshot, seed: string): RulebookSnapshot {
  const behaviors = rulebook.rules.map((r) => r.recommendedBehavior);
  const scrambled = deterministicShuffle(behaviors, seed);
  const rules: PolicyRule[] = rulebook.rules.map((r, i) => ({
    id: r.id,
    recommendedBehavior: scrambled[i]!,
    ...(r.rationale !== undefined ? { rationale: r.rationale } : {}),
  }));
  return { version: rulebook.version, rules };
}
