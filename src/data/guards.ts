import type { GroundTruth, HistoricalRecord, SplitName } from "../contracts/types.js";
import { loadExcludedDuplicateFamilies, loadGroundTruth } from "./manifests.js";

/**
 * Verifies TRAIN/DEV/FINAL_HOLDOUT issue-number sets are pairwise disjoint.
 * Throws on any overlap — split contamination invalidates the benchmark.
 */
export function assertNoSplitOverlap(
  train: readonly GroundTruth[] = loadGroundTruth("TRAIN"),
  dev: readonly GroundTruth[] = loadGroundTruth("DEV"),
  finalHoldout: readonly GroundTruth[] = loadGroundTruth("FINAL_HOLDOUT"),
): void {
  const sets: Record<SplitName, Set<number>> = {
    TRAIN: new Set(train.map((r) => r.number)),
    DEV: new Set(dev.map((r) => r.number)),
    FINAL_HOLDOUT: new Set(finalHoldout.map((r) => r.number)),
  };
  const pairs: [SplitName, SplitName][] = [
    ["TRAIN", "DEV"],
    ["TRAIN", "FINAL_HOLDOUT"],
    ["DEV", "FINAL_HOLDOUT"],
  ];
  for (const [a, b] of pairs) {
    const overlap = [...sets[a]].filter((n) => sets[b].has(n));
    if (overlap.length > 0) {
      throw new Error(`Split overlap between ${a} and ${b}: issue numbers ${overlap.join(", ")}`);
    }
  }
}

/**
 * Verifies no ground-truth record in any split has a number listed in the
 * frozen cross-split duplicate-family exclusion manifest. Those 14 issues
 * must never be evaluated (EVAL_CONTRACT.md §12.4).
 */
export function assertDuplicateFamiliesExcluded(
  train: readonly GroundTruth[] = loadGroundTruth("TRAIN"),
  dev: readonly GroundTruth[] = loadGroundTruth("DEV"),
  finalHoldout: readonly GroundTruth[] = loadGroundTruth("FINAL_HOLDOUT"),
): void {
  const excluded = new Set(loadExcludedDuplicateFamilies().excludedIssueNumbers);
  const all = [...train, ...dev, ...finalHoldout];
  const violations = all.filter((r) => excluded.has(r.number));
  if (violations.length > 0) {
    throw new Error(
      `Duplicate-family guard FAILED: manifest(s) contain excluded issue number(s) ` +
        `${violations.map((v) => v.number).join(", ")}`,
    );
  }
}

/**
 * Enforces the historical search contract (EVAL_CONTRACT.md §12.6):
 * any historical record returned for current issue T must satisfy
 * historical.createdAt < T.createdAt. Filters out violators rather than
 * throwing, since a lookup tool may legitimately query a broad pool.
 */
export function filterToPastRecords<T extends { readonly createdAt: string }>(
  candidates: readonly T[],
  currentCreatedAt: string,
): T[] {
  const cutoff = Date.parse(currentCreatedAt);
  if (Number.isNaN(cutoff)) {
    throw new Error(`Invalid currentCreatedAt: ${currentCreatedAt}`);
  }
  return candidates.filter((c) => {
    const t = Date.parse(c.createdAt);
    if (Number.isNaN(t)) {
      throw new Error(`Invalid createdAt on candidate record: ${c.createdAt}`);
    }
    return t < cutoff;
  });
}

/**
 * Strict assertion form: throws if ANY candidate violates the historical
 * search contract, for use where a caller has promised pre-filtering
 * already happened and wants a hard guarantee before proceeding.
 */
export function assertAllPast(candidates: readonly HistoricalRecord[], currentCreatedAt: string): void {
  const cutoff = Date.parse(currentCreatedAt);
  const violators = candidates.filter((c) => Date.parse(c.createdAt) >= cutoff);
  if (violators.length > 0) {
    throw new Error(
      `Future-record guard FAILED: ${violators.length} historical record(s) with createdAt >= ` +
        `current issue's createdAt (${currentCreatedAt}): ${violators.map((v) => v.number).join(", ")}`,
    );
  }
}
