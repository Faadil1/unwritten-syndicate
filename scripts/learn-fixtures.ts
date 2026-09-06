import { buildFixtureTrainRounds } from "../src/learning/fixtures.js";
import { RuleBasedPolicyAgent } from "../src/learning/policyAgent.js";
import { runLearningLoop } from "../src/learning/orchestrator.js";

/**
 * Demonstration/manual-check entry point for the 3-round learning loop,
 * using synthetic TRAIN-only fixtures (see src/learning/fixtures.ts —
 * data/train.jsonl has not been materialized yet, GATE 02). Writes
 * memory/V0.json..V3.json and prints round-by-round metrics. This is NOT a
 * benchmark run: no DEV/FINAL_HOLDOUT data is touched, and the numbers below
 * mean nothing outside this synthetic exercise.
 */
const trainRounds = buildFixtureTrainRounds();
const policyAgent = new RuleBasedPolicyAgent();

const result = runLearningLoop({ trainRounds, policyAgent });

console.log("=== learn:fixtures (synthetic TRAIN-only fixture data, NOT a benchmark run) ===");
for (const { round, metrics } of result.rounds) {
  console.log(
    `  round ${round}: examples_seen=${metrics.examplesSeen} candidate=${metrics.candidateRules} ` +
      `active=${metrics.activeRules} retired=${metrics.retiredRules} contradictions=${metrics.contradictions} ` +
      `compression_ratio=${metrics.compressionRatio.toFixed(2)}`,
  );
}
console.log(`Snapshots written: ${result.snapshotsWritten.join(", ")}`);
