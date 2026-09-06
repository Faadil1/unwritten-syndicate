import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGroundTruth, MANIFEST_DIR } from "../src/data/manifests.js";
import { evaluate } from "../src/eval/metrics.js";
import type { Prediction, ResolutionDisposition } from "../src/contracts/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;

/**
 * Reproduces the frozen GATE 01C cold-baseline macro-F1 (EVAL_CONTRACT.md
 * §12.5) using our own metrics engine, against DEV only. This does NOT
 * touch FINAL_HOLDOUT and does NOT run any new model inference — it only
 * re-scores the already-recorded predictions to prove our metrics.ts is
 * consistent with the frozen record.
 */
interface RawColdBaseline {
  macro_f1: number;
  accuracy: number;
  predictions: { number: number; prediction: ResolutionDisposition; truth: ResolutionDisposition }[];
}

const file = path.join(MANIFEST_DIR, "dev_cold_baseline_results.json");
const raw = JSON.parse(readFileSync(file, "utf8")) as RawColdBaseline;

const groundTruth = loadGroundTruth("DEV");
const predictions: Prediction[] = raw.predictions.map((p) => ({
  number: p.number,
  predicted: p.prediction,
}));

const result = evaluate("DEV", groundTruth, predictions);

console.log("=== eval:cold (DEV, reproducing frozen GATE 01C cold baseline) ===");
console.log(`  computed macro-F1: ${result.macroF1.toFixed(4)}  (frozen record: ${raw.macro_f1})`);
console.log(`  computed accuracy: ${result.accuracy.toFixed(4)}  (frozen record: ${raw.accuracy})`);
for (const c of result.perClass) {
  console.log(
    `  ${c.label}: P=${c.precision.toFixed(3)} R=${c.recall.toFixed(3)} F1=${c.f1.toFixed(3)} support=${c.support}`,
  );
}

const macroMatches = Math.abs(result.macroF1 - raw.macro_f1) < 0.0005;
const accMatches = Math.abs(result.accuracy - raw.accuracy) < 0.0005;
if (!macroMatches || !accMatches) {
  console.error("eval:cold FAILED — recomputed metrics do not match the frozen record.");
  process.exit(1);
}
console.log("eval:cold PASSED — metrics engine reproduces the frozen GATE 01C cold-baseline scores.");
