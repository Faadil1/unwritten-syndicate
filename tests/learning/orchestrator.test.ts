import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtureTrainRounds } from "../../src/learning/fixtures.js";
import { RuleBasedPolicyAgent, type PolicyAgent, type PolicyDecision } from "../../src/learning/policyAgent.js";
import { runLearningLoop, type TrainExample } from "../../src/learning/orchestrator.js";
import { MAX_ACTIVE_RULES } from "../../src/rulebook/rulebook.js";
import type { PredictorInput } from "../../src/contracts/types.js";
import type { Rule } from "../../src/rulebook/types.js";

describe("runLearningLoop — structural contract", () => {
  it("requires exactly 3 TRAIN batches", () => {
    const agent = new RuleBasedPolicyAgent();
    expect(() => runLearningLoop({ trainRounds: [[], []], policyAgent: agent, persist: false })).toThrow(/exactly 3/);
  });

  it("reuses the same PolicyAgent instance for every example across all 3 rounds (fixed system prompt / no per-round rewriting)", () => {
    const calls: { input: PredictorInput; activeRules: readonly Rule[] }[] = [];
    const spyAgent: PolicyAgent = {
      name: "spy",
      predict(input, activeRules): PolicyDecision {
        calls.push({ input, activeRules });
        return { predicted: "RESOLVED_COMPLETED", firedRuleIds: [], confidence: 0 };
      },
    };
    const trainRounds = buildFixtureTrainRounds();
    const totalExamples = trainRounds.reduce((s, batch) => s + batch.length, 0);
    runLearningLoop({ trainRounds, policyAgent: spyAgent, persist: false });
    expect(calls).toHaveLength(totalExamples);
  });
});

describe("runLearningLoop — 3-round orchestration with fixtures", () => {
  it("produces a V0 (pre-training) round plus one report per training round, with monotonically increasing examples_seen", () => {
    const result = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    expect(result.rounds.map((r) => r.round)).toEqual([0, 1, 2, 3]);
    expect(result.rounds[0]!.metrics.examplesSeen).toBe(0);
    expect(result.rounds[1]!.metrics.examplesSeen).toBe(12);
    expect(result.rounds[2]!.metrics.examplesSeen).toBe(24);
    expect(result.rounds[3]!.metrics.examplesSeen).toBe(36);
  });

  it("never exceeds MAX_ACTIVE_RULES at any round", () => {
    const result = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    for (const round of result.rounds) {
      expect(round.metrics.activeRules).toBeLessThanOrEqual(MAX_ACTIVE_RULES);
    }
  });

  it("every rule ends in a valid lifecycle status, and evidence accumulates across rounds (round 3 has >= round 1 candidate+active rule count)", () => {
    const result = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    const validStatuses = new Set(["candidate", "active", "contradicted", "retired"]);
    for (const rule of result.rulebook.getRules()) {
      expect(validStatuses.has(rule.status)).toBe(true);
    }
    const round1Live = result.rounds[1]!.metrics.candidateRules + result.rounds[1]!.metrics.activeRules;
    const round3Live = result.rounds[3]!.metrics.candidateRules + result.rounds[3]!.metrics.activeRules;
    expect(round3Live).toBeGreaterThanOrEqual(round1Live);
  });

  it("promotes a candidate to active once multi-round evidence accumulates enough confidence", () => {
    const result = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    const contributorRule = result.rulebook
      .getRules()
      .find(
        (r) =>
          r.conditions.length === 1 &&
          r.conditions[0]!.feature === "authorAssociation" &&
          r.conditions[0]!.value === "CONTRIBUTOR",
      );
    expect(contributorRule).toBeDefined();
    expect(contributorRule!.status).toBe("active");
    expect(contributorRule!.supportCount).toBeGreaterThan(4); // accumulated across multiple rounds, not just one batch
  });
});

describe("runLearningLoop — determinism under mocked/fixed inputs", () => {
  it("two independent runs over the same fixtures + same deterministic PolicyAgent produce identical final rule sets and metrics", () => {
    const runA = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    const runB = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    expect(runB.rulebook.getRules()).toEqual(runA.rulebook.getRules());
    expect(runB.rounds).toEqual(runA.rounds);
  });
});

describe("runLearningLoop — persistence", () => {
  it("does not touch disk when persist=false", () => {
    const result = runLearningLoop({
      trainRounds: buildFixtureTrainRounds(),
      policyAgent: new RuleBasedPolicyAgent(),
      persist: false,
    });
    expect(result.snapshotsWritten).toEqual([]);
  });

  it("writes memory/V0.json..V3.json to the given directory when persist=true (default)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "unwritten-memory-"));
    try {
      const result = runLearningLoop({
        trainRounds: buildFixtureTrainRounds(),
        policyAgent: new RuleBasedPolicyAgent(),
        memoryDir: dir,
      });
      expect(result.snapshotsWritten).toHaveLength(4);
      const files = readdirSync(dir).sort();
      expect(files).toEqual(["V0.json", "V1.json", "V2.json", "V3.json"]);

      const v3 = JSON.parse(readFileSync(path.join(dir, "V3.json"), "utf8"));
      expect(v3.version).toBe("V3");
      expect(v3.round).toBe(3);
      expect(v3.metrics.examples_seen).toBe(36);
      expect(Array.isArray(v3.rules)).toBe(true);

      const v0 = JSON.parse(readFileSync(path.join(dir, "V0.json"), "utf8"));
      expect(v0.round).toBe(0);
      expect(v0.rules).toEqual([]);
      expect(v0.metrics.examples_seen).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runLearningLoop — DEV/FINAL cannot update memory", () => {
  it("has no way to construct a TrainExample from a non-TRAIN split (no split field exists on the type)", () => {
    // Structural guarantee: TrainExample only carries number/input/actual — there
    // is no split field to set to "DEV"/"FINAL_HOLDOUT" in the first place. This
    // is asserted here by construction: the object below satisfies TrainExample
    // and could not, even by mistake, be tagged as anything but TRAIN.
    const ex: TrainExample = {
      number: 1,
      input: { title: "t", body: "b", createdAt: "2025-01-01T00:00:00Z", authorAssociation: "NONE" },
      actual: "RESOLVED_COMPLETED",
    };
    expect(Object.keys(ex).sort()).toEqual(["actual", "input", "number"]);
  });
});
