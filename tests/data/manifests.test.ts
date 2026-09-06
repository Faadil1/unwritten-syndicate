import { describe, expect, it } from "vitest";
import { loadGroundTruth, verifyManifestHashes } from "../../src/data/manifests.js";
import { assertNoSplitOverlap, assertDuplicateFamiliesExcluded } from "../../src/data/guards.js";

describe("manifest hashes", () => {
  it("match the frozen GATE 01C freeze record", () => {
    const results = verifyManifestHashes();
    for (const r of results) {
      expect(r.actual, `${r.file} hash mismatch`).toBe(r.expected);
    }
  });
});

describe("split disjointness", () => {
  it("TRAIN / DEV / FINAL_HOLDOUT have no overlapping issue numbers", () => {
    expect(() => assertNoSplitOverlap()).not.toThrow();
  });

  it("detects an injected overlap", () => {
    const train = loadGroundTruth("TRAIN");
    const dev = loadGroundTruth("DEV");
    const finalHoldout = loadGroundTruth("FINAL_HOLDOUT");
    const contaminatedDev = [...dev, train[0]!];
    expect(() => assertNoSplitOverlap(train, contaminatedDev, finalHoldout)).toThrow(/overlap/i);
  });
});

describe("duplicate-family exclusion", () => {
  it("frozen manifests contain none of the excluded issue numbers", () => {
    expect(() => assertDuplicateFamiliesExcluded()).not.toThrow();
  });

  it("detects an injected excluded-family issue", () => {
    const train = loadGroundTruth("TRAIN");
    const dev = loadGroundTruth("DEV");
    const finalHoldout = loadGroundTruth("FINAL_HOLDOUT");
    const contaminatedTrain = [
      ...train,
      { number: 415, label: "RESOLVED_COMPLETED" as const, subtype: "COMPLETED" as const, createdAt: "2025-01-01T00:00:00Z" },
    ];
    expect(() => assertDuplicateFamiliesExcluded(contaminatedTrain, dev, finalHoldout)).toThrow(
      /duplicate-family/i,
    );
  });
});

describe("frozen counts", () => {
  it("TRAIN has 206 records, DEV 66, FINAL_HOLDOUT 88", () => {
    expect(loadGroundTruth("TRAIN")).toHaveLength(206);
    expect(loadGroundTruth("DEV")).toHaveLength(66);
    expect(loadGroundTruth("FINAL_HOLDOUT")).toHaveLength(88);
  });

  it("class counts match EVAL_CONTRACT.md §12.8", () => {
    const count = (split: "TRAIN" | "DEV" | "FINAL_HOLDOUT", label: string) =>
      loadGroundTruth(split).filter((r) => r.label === label).length;
    expect(count("TRAIN", "RESOLVED_COMPLETED")).toBe(176);
    expect(count("TRAIN", "RESOLVED_NO_NEW_WORK")).toBe(30);
    expect(count("DEV", "RESOLVED_COMPLETED")).toBe(56);
    expect(count("DEV", "RESOLVED_NO_NEW_WORK")).toBe(10);
    expect(count("FINAL_HOLDOUT", "RESOLVED_COMPLETED")).toBe(73);
    expect(count("FINAL_HOLDOUT", "RESOLVED_NO_NEW_WORK")).toBe(15);
  });
});
