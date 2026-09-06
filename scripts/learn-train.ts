import { loadRealTrainRounds } from "../src/data/trainExamples.js";
import { RuleBasedPolicyAgent } from "../src/learning/policyAgent.js";
import { runLearningLoop } from "../src/learning/orchestrator.js";

/**
 * The REAL production learning entry point: runs the 3-round learning loop
 * over the materialized TRAIN split (data/train.jsonl + the frozen GATE 01C
 * TRAIN manifest), not synthetic fixtures. Writes memory/V0.json..V3.json.
 *
 * This is the canonical way to (re)generate the Rulebook snapshots that back
 * A2 (scrambled control) and A3 (real learned policy) in the DEV bakeoff.
 * src/learning/fixtures.ts + `npm run learn:fixtures` remain for exercising
 * the pipeline in unit tests only — they must never be the source memory/V*
 * snapshots are regenerated from in this script.
 *
 * Reports no benchmark performance — TRAIN-round metrics here describe rule
 * lifecycle/compression only (support/active/retired/contradiction counts),
 * never DEV/FINAL_HOLDOUT accuracy.
 */
const loaded = loadRealTrainRounds();

if (!loaded.available) {
  console.log(
    "learn:train — data/train.jsonl not materialized in this checkout. Run `npm run data:materialize` first. " +
      "No memory snapshots written, nothing fabricated.",
  );
  process.exit(0);
}

if (loaded.missingNumbers.length > 0) {
  console.error(
    `learn:train FAILED — ${loaded.missingNumbers.length} materialized TRAIN row(s) had no matching ground truth: ` +
      loaded.missingNumbers.join(","),
  );
  process.exit(1);
}

if (loaded.totalRecords !== 206) {
  console.error(
    `learn:train FAILED — expected exactly 206 TRAIN records (frozen GATE 01C manifest), got ${loaded.totalRecords}.`,
  );
  process.exit(1);
}

const policyAgent = new RuleBasedPolicyAgent();
const result = runLearningLoop({ trainRounds: loaded.rounds, policyAgent });

console.log("=== learn:train (REAL TRAIN materialization, 206 records) ===");
console.log(`  TRAIN records consumed: ${loaded.totalRecords} (rounds: ${loaded.rounds.map((r) => r.length).join(", ")})`);
for (const { round, metrics } of result.rounds) {
  console.log(
    `  round ${round}: examples_seen=${metrics.examplesSeen} candidate=${metrics.candidateRules} ` +
      `active=${metrics.activeRules} retired=${metrics.retiredRules} contradictions=${metrics.contradictions} ` +
      `compression_ratio=${metrics.compressionRatio.toFixed(2)}`,
  );
}
console.log(`Snapshots written: ${result.snapshotsWritten.join(", ")}`);

const finalActive = result.rulebook.getRules("active").length;
if (finalActive === 0) {
  console.warn(
    "learn:train WARNING — V3 has zero active rules. The learned policy degenerates to the fixed default prior; " +
      "report this explicitly, do not hide it.",
  );
}
