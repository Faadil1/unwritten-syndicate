import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRulebookToolHeuristics, __testing } from "../../src/rulebook/toolHeuristicAdapter.js";
import { readSnapshotFile } from "../../src/rulebook/snapshot.js";
import { makeA1Predictor, makeA3Predictor, runA0Cold } from "../../src/eval/harness.js";
import { HistoricalRecordStore } from "../../src/data/historicalRecords.js";
import { DEV_HISTORICAL_SEARCH_TOP_K } from "../../src/eval/retrievalConfig.js";
import type { Rule } from "../../src/rulebook/types.js";
import type { HistoricalRecord, PredictorInput } from "../../src/contracts/types.js";
import type { ToolHeuristicContext } from "../../src/tools/toolHeuristics.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

/**
 * SESSION E4 — bounded tool-search recovery.
 *
 * Root cause of SEARCH=0/66 under E3R: the V3 Rulebook is 12 single-feature
 * marginal rules that together cover EVERY value of EVERY abstracted feature,
 * each recommending RESOLVED_COMPLETED with confidence 0.81–0.90 — i.e. each
 * rule's confidence merely tracks the ~0.85 dominant-class frequency. The old
 * gate skipped search whenever ANY matching rule had confidence >= 0.80 over
 * >= 3 support, so with total coverage that fired for 100% of inputs and the
 * retrieval path was never exercised. The fix: a matching rule only
 * suppresses search if it beats the base rate its own TRAIN evidence implies
 * (halves the residual error), and contradictory matches always search.
 */
describe("SESSION E4: base-rate-aware search gate", () => {
  /** A V3-shaped partition: rules covering both values of a boolean feature, each near the class prior. */
  function marginalPartition(): Rule[] {
    return [
      rule({
        id: "cb-false",
        type: "content_shape_signal",
        conditions: [{ feature: "hasCodeBlock", operator: "falsy" }],
        confidence: 103 / 126,
        supportCount: 126,
        successCount: 103,
        failureCount: 23,
      }),
      rule({
        id: "cb-true",
        type: "content_shape_signal",
        conditions: [{ feature: "hasCodeBlock", operator: "truthy" }],
        confidence: 73 / 80,
        supportCount: 80,
        successCount: 73,
        failureCount: 7,
      }),
    ];
  }

  it("derives the dominant-class prior from the Rulebook's own partition evidence (no DEV/FINAL truth)", () => {
    const prior = __testing.rulebookClassPrior(marginalPartition(), "RESOLVED_COMPLETED");
    expect(prior).toBeCloseTo(176 / 206, 10); // 0.854 — the class balance implied by TRAIN support alone
    expect(__testing.sufficiencyThreshold(marginalPartition(), "RESOLVED_COMPLETED")).toBeCloseTo(
      1 - (1 - 176 / 206) / 2,
      10,
    );
  });

  it("(1) a low-confidence / only-marginal matching rule triggers SEARCH", () => {
    // Input has no code block -> matches cb-false (confidence 0.817), which does
    // not beat the 0.854 base rate. Only a marginal signal -> search.
    const hooks = createRulebookToolHeuristics(marginalPartition());
    const decision = hooks.shouldSearch(ctx({ input: baseInput({ body: "plain text, no fences" }) }));
    expect(decision.action).toBe("SEARCH");
    expect(decision.reason).toMatch(/base-rate/);
  });

  it("(1b) the REAL frozen V3 Rulebook now searches for a representative input", () => {
    const v3 = readSnapshotFile(path.join(REPO_ROOT, "memory"), "V3");
    expect(v3.available).toBe(true);
    const activeRules = v3.snapshot!.rules.filter((r) => r.status === "active");
    expect(activeRules).toHaveLength(12);
    const hooks = createRulebookToolHeuristics(activeRules);
    for (const assoc of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR"] as const) {
      for (const body of ["hi", "x".repeat(400), "x".repeat(1200)]) {
        const decision = hooks.shouldSearch(
          ctx({ input: baseInput({ authorAssociation: assoc, body, title: "fix the thing" }) }),
        );
        expect(decision.action).toBe("SEARCH");
      }
    }
  });

  it("(2) a genuinely high-confidence, base-rate-beating rule still skips search", () => {
    const rules: Rule[] = [
      ...marginalPartition(),
      rule({
        id: "decisive",
        type: "authorship_signal",
        conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
        confidence: 0.97, // well past the 0.927 "halve the error" bar
        supportCount: 400, // and the strongest match by confidence*support
        successCount: 388,
        failureCount: 12,
      }),
    ];
    const hooks = createRulebookToolHeuristics(rules);
    const decision = hooks.shouldSearch(ctx({ input: baseInput({ authorAssociation: "NONE" }) }));
    expect(decision.action).toBe("HIGH_CONFIDENCE_SUFFICIENT");
    expect(decision.reason).toContain("decisive");
  });

  it("contradictory matching rules always search, even if one is very confident", () => {
    const rules: Rule[] = [
      rule({
        id: "says-completed",
        conditions: [{ feature: "authorAssociation", operator: "equals", value: "NONE" }],
        recommendedBehavior: "RESOLVED_COMPLETED",
        confidence: 0.99,
        supportCount: 200,
        successCount: 198,
        failureCount: 2,
      }),
      rule({
        id: "says-no-new-work",
        type: "content_shape_signal",
        conditions: [{ feature: "hasCodeBlock", operator: "falsy" }],
        recommendedBehavior: "RESOLVED_NO_NEW_WORK",
        confidence: 0.9,
        supportCount: 50,
        successCount: 45,
        failureCount: 5,
      }),
    ];
    const hooks = createRulebookToolHeuristics(rules);
    const decision = hooks.shouldSearch(ctx({ input: baseInput({ authorAssociation: "NONE", body: "no fences here" }) }));
    expect(decision.action).toBe("SEARCH");
    expect(decision.reason).toMatch(/disagree/);
  });

  it("no isolated single rule regresses: with no partition to compare against, the absolute floor still applies", () => {
    expect(createRulebookToolHeuristics([rule({ confidence: 0.9 })]).shouldSearch(ctx()).action).toBe(
      "HIGH_CONFIDENCE_SUFFICIENT",
    );
    expect(createRulebookToolHeuristics([rule({ confidence: 0.79 })]).shouldSearch(ctx()).action).toBe("SEARCH");
  });
});

describe("SESSION E4: (3) the search gate reads no DEV/FINAL ground truth", () => {
  const adapterFile = path.join(REPO_ROOT, "src", "rulebook", "toolHeuristicAdapter.ts");
  const files = [adapterFile, path.join(REPO_ROOT, "src", "tools", "toolHeuristics.ts")];
  for (const file of files) {
    it(`${path.relative(REPO_ROOT, file)} contains no ground-truth / label-file access`, () => {
      const src = readFileSync(file, "utf8");
      expect(/groundTruthAccess/.test(src)).toBe(false);
      expect(/loadGroundTruth/.test(src)).toBe(false);
      expect(/dev\.jsonl|final_holdout|FINAL_HOLDOUT/.test(src)).toBe(false);
      expect(/manifest_dev|manifest_final/.test(src)).toBe(false);
    });
  }

  it("createRulebookToolHeuristics is a pure function of Rule[] + PredictorInput features only", () => {
    // The only inputs are the rule list (closure) and the ToolHeuristicContext;
    // there is no filesystem/network parameter and no import of a data loader.
    const src = readFileSync(adapterFile, "utf8");
    expect(/from "node:fs"|from "node:https?"|fetch\(/.test(src)).toBe(false);
  });
});

describe("SESSION E4: (4) A1 and A3 share the identical retrieval configuration", () => {
  function hist(number: number, createdAt: string): HistoricalRecord {
    return {
      number,
      title: `h${number}`,
      body: "body",
      createdAt,
      authorAssociation: "NONE",
      label: "RESOLVED_COMPLETED",
      subtype: "COMPLETED",
    };
  }

  it("top-k is the single frozen constant (5) for both arms", () => {
    expect(DEV_HISTORICAL_SEARCH_TOP_K).toBe(5);
  });

  it("when A3's gate chooses SEARCH, it retrieves exactly what A1 retrieves (same corpus, top-k, recency ranking, temporal filter)", async () => {
    const records = [
      hist(1, "2024-01-01T00:00:00Z"),
      hist(2, "2024-03-01T00:00:00Z"),
      hist(3, "2024-05-01T00:00:00Z"),
      hist(4, "2024-07-01T00:00:00Z"),
      hist(5, "2024-09-01T00:00:00Z"),
      hist(6, "2024-11-01T00:00:00Z"),
      hist(7, "2025-06-01T00:00:00Z"), // future — must be temporally excluded
    ];
    const storeA1 = new HistoricalRecordStore(records);
    const storeA3 = new HistoricalRecordStore(records);
    const input: PredictorInput = {
      title: "t",
      body: "no fences",
      createdAt: "2025-01-01T00:00:00Z",
      authorAssociation: "NONE",
    };

    let a1History: readonly HistoricalRecord[] = [];
    const a1 = makeA1Predictor(storeA1, DEV_HISTORICAL_SEARCH_TOP_K, (_i, h) => {
      a1History = h;
      return "RESOLVED_COMPLETED";
    });

    // A3 gate forced to SEARCH by a marginal Rulebook (mirrors the real V3).
    const marginalRules: Rule[] = [
      rule({
        id: "cb-false",
        type: "content_shape_signal",
        conditions: [{ feature: "hasCodeBlock", operator: "falsy" }],
        confidence: 103 / 126,
        supportCount: 126,
        successCount: 103,
        failureCount: 23,
      }),
      rule({
        id: "cb-true",
        type: "content_shape_signal",
        conditions: [{ feature: "hasCodeBlock", operator: "truthy" }],
        confidence: 73 / 80,
        supportCount: 80,
        successCount: 73,
        failureCount: 7,
      }),
    ];
    let a3History: readonly HistoricalRecord[] = [];
    const a3 = makeA3Predictor(
      storeA3,
      DEV_HISTORICAL_SEARCH_TOP_K,
      marginalRules,
      createRulebookToolHeuristics(marginalRules),
      (_i, _r, h) => {
        a3History = h;
        return "RESOLVED_COMPLETED";
      },
    );

    await runA0Cold(a1, [{ number: 99, input }]);
    await runA0Cold(a3, [{ number: 99, input }]);

    expect(a3History.map((h) => h.number)).toEqual(a1History.map((h) => h.number));
    expect(a1History.map((h) => h.number)).toEqual([6, 5, 4, 3, 2]); // recency-ranked, top-5, no future record
  });
});

describe("SESSION E4: (5) memory V0–V3 snapshots are untouched by this iteration", () => {
  const FROZEN_V3_HASH = "f9bf2abe268d34cd5c8f900500ff5171a663e8e4b53f96061fb1211aa10c86eb";

  it("memory/V3.json still hashes to the frozen E2/E3R value", () => {
    const h = createHash("sha256")
      .update(readFileSync(path.join(REPO_ROOT, "memory", "V3.json")))
      .digest("hex");
    expect(h).toBe(FROZEN_V3_HASH);
  });

  it("memory/V0–V3 all present and parse as rulebook snapshots", () => {
    for (const v of ["V0", "V1", "V2", "V3"] as const) {
      const snap = readSnapshotFile(path.join(REPO_ROOT, "memory"), v);
      expect(snap.available).toBe(true);
      expect(snap.snapshot!.version).toBe(v);
    }
  });
});
