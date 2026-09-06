import { loadGroundTruth } from "../src/data/manifests.js";
import { loadPredictorInputs } from "../src/data/predictorInput.js";
import { runA0Cold } from "../src/eval/harness.js";
import { evaluate } from "../src/eval/metrics.js";
import type { Predictor } from "../src/eval/harness.js";

/**
 * A0 cold-eval plumbing runner for DEV. Requires data/dev.jsonl (title+body
 * materialization) to exist — that is GATE 02's deliverable, not this
 * gate's. If it is not present yet, this script reports that plainly and
 * exits 0 rather than fabricating a result.
 *
 * Wire a real predictor by replacing `placeholderPredictor` below once a
 * model call is authorized for this project.
 */
const placeholderPredictor: Predictor = () => "RESOLVED_COMPLETED";

async function main() {
  const { available, records, extraNumbers, missingNumbers } = loadPredictorInputs("DEV");

  if (!available) {
    console.log(
      "eval:dev — data/dev.jsonl not yet materialized (GATE 02 deliverable). " +
        "Harness plumbing is wired and ready; nothing to run yet. No result fabricated.",
    );
    return;
  }

  if (extraNumbers.length > 0 || missingNumbers.length > 0) {
    console.error(
      `eval:dev FAILED — data/dev.jsonl issue-number set does not match the frozen DEV manifest. ` +
        `extra=${extraNumbers.join(",")} missing=${missingNumbers.join(",")}`,
    );
    process.exit(1);
  }

  const groundTruth = loadGroundTruth("DEV");
  const items = records.map((r) => ({ number: r.number, input: r.input }));
  const predictions = await runA0Cold(placeholderPredictor, items);
  const result = evaluate("DEV", groundTruth, predictions);

  console.log("=== eval:dev (A0 cold, DEV) ===");
  console.log(`  macro-F1: ${result.macroF1.toFixed(4)}`);
  console.log(`  accuracy: ${result.accuracy.toFixed(4)}`);
  console.log(`  scored=${result.scored} errored=${result.errored} total=${result.totalRecords}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
