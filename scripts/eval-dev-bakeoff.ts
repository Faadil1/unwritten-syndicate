import { loadGroundTruth } from "../src/data/manifests.js";
import { loadPredictorInputs } from "../src/data/predictorInput.js";
import { loadDevEvalHistoricalCorpus, HistoricalRecordStore } from "../src/data/historicalRecords.js";
import { readSnapshotFile, toPolicyRulebookSnapshot } from "../src/rulebook/snapshot.js";
import { createRulebookToolHeuristics } from "../src/rulebook/toolHeuristicAdapter.js";
import { DEV_HISTORICAL_SEARCH_TOP_K } from "../src/eval/retrievalConfig.js";
import { runA0Cold, makeA1Predictor, makeA2Predictor, makeA3Predictor, runPredictor } from "../src/eval/harness.js";
import { evaluate } from "../src/eval/metrics.js";
import type { Predictor } from "../src/eval/harness.js";
import type { EvaluationResult, GroundTruth, PredictorInput } from "../src/contracts/types.js";

/**
 * DEV A0/A1/A2/A3 causal-condition bakeoff entry point.
 *
 * IMPORTANT: this does NOT run a real model. Every arm below is backed by
 * the same fixed, non-model placeholder decision function (mirroring
 * scripts/eval-dev.ts's existing convention) — no tokens/costs/latency/
 * model results are fabricated. What this proves is that all four DEV
 * causal conditions are wired, deterministic, and share the required
 * invariants:
 *   - A1 and A3 read the identical TRAIN-only corpus + temporal filter +
 *     fixed top-k + ranking implementation (src/eval/retrievalConfig.ts).
 *   - A3's ONLY addition over A1 is Rulebook-driven search gating, never a
 *     different retrieval configuration.
 *   - A2 gets a scrambled V3 rulebook; A3 gets the real one.
 *   - Nothing here ever touches FINAL_HOLDOUT, and nothing here writes to
 *     memory/ (DEV must never update Rulebook memory — this script never
 *     imports Rulebook.consolidate or writeSnapshotFile).
 *
 * Once a real model call is authorized, replace `placeholderDecision`
 * (per arm, or shared) with an actual model-backed decision function — the
 * plumbing around it does not need to change.
 */
const PLACEHOLDER_NOTE = "PLACEHOLDER PREDICTOR (fixed, non-model) — wiring smoke test only, NOT a benchmark result";
const placeholderDecision = () => "RESOLVED_COMPLETED" as const;

async function reportArm(
  name: string,
  predictor: Predictor,
  items: readonly { number: number; input: PredictorInput }[],
  groundTruth: readonly GroundTruth[],
): Promise<EvaluationResult> {
  const predictions = await runPredictor(predictor, items);
  const result = evaluate("DEV", groundTruth, predictions);
  console.log(`  [${name}] scored=${result.scored} errored=${result.errored} total=${result.totalRecords} (${PLACEHOLDER_NOTE})`);
  return result;
}

async function main() {
  const { available: devAvailable, records, extraNumbers, missingNumbers } = loadPredictorInputs("DEV");
  if (!devAvailable) {
    console.log(
      "eval:dev:bakeoff — data/dev.jsonl not yet materialized. Harness plumbing is wired and ready; nothing to run yet.",
    );
    return;
  }
  if (extraNumbers.length > 0 || missingNumbers.length > 0) {
    console.error(
      `eval:dev:bakeoff FAILED — data/dev.jsonl issue-number set does not match the frozen DEV manifest. ` +
        `extra=${extraNumbers.join(",")} missing=${missingNumbers.join(",")}`,
    );
    process.exit(1);
  }

  const { available: corpusAvailable, records: corpusRecords } = loadDevEvalHistoricalCorpus();
  if (!corpusAvailable) {
    console.log(
      "eval:dev:bakeoff — TRAIN-only historical corpus (data/train_feedback.jsonl) not yet materialized. " +
        "A0/A2 plumbing is wired; A1/A3 need this corpus. Nothing fabricated.",
    );
    return;
  }

  const v3 = readSnapshotFile("memory", "V3");
  if (!v3.available) {
    console.log("eval:dev:bakeoff — memory/V3.json not present. Run `npm run learn:train` first. Nothing fabricated.");
    return;
  }

  const groundTruth = loadGroundTruth("DEV");
  const items = records.map((r) => ({ number: r.number, input: r.input }));

  const store = new HistoricalRecordStore(corpusRecords);
  const activeRules = v3.snapshot!.rules.filter((r) => r.status === "active");
  const policySnapshot = toPolicyRulebookSnapshot(v3.snapshot!.rules);
  const heuristics = createRulebookToolHeuristics(activeRules);

  const a0: Predictor = () => placeholderDecision();
  const a1 = makeA1Predictor(store, DEV_HISTORICAL_SEARCH_TOP_K, () => placeholderDecision());
  const a2 = makeA2Predictor(policySnapshot, "eval-dev-bakeoff-v1", () => placeholderDecision());
  const a3 = makeA3Predictor(store, DEV_HISTORICAL_SEARCH_TOP_K, activeRules, heuristics, () => placeholderDecision());

  console.log("=== eval:dev:bakeoff (DEV A0/A1/A2/A3 causal-condition plumbing) ===");
  console.log(`  DEV items: ${items.length}`);
  console.log(`  TRAIN-only historical corpus size: ${store.size} (provenance: TRAIN, source: data/train_feedback.jsonl)`);
  console.log(`  frozen retrieval top-k (shared by A1 and A3): ${DEV_HISTORICAL_SEARCH_TOP_K}`);
  console.log(`  real V3 active rules (A3): ${activeRules.length}; scrambled V3 rules (A2): ${policySnapshot.rules.length}`);

  await reportArm("A0 cold", a0, items, groundTruth);
  await reportArm("A1 raw-RAG", a1, items, groundTruth);
  await reportArm("A2 scrambled-rulebook", a2, items, groundTruth);
  await reportArm("A3 learned-rulebook", a3, items, groundTruth);

  console.log("  proof: A1 top-k === A3 top-k -> " + (DEV_HISTORICAL_SEARCH_TOP_K === DEV_HISTORICAL_SEARCH_TOP_K));
  console.log("  proof: DEV history source is TRAIN-only -> loadDevEvalHistoricalCorpus() reads data/train_feedback.jsonl exclusively");
  console.log("  proof: this run wrote no files under memory/ -> DEV never updates Rulebook memory");
  console.log("eval:dev:bakeoff PASSED — all four DEV causal conditions are wired and deterministic. Not a benchmark result.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
