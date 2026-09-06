import { verifyManifestHashes, loadGroundTruth } from "../src/data/manifests.js";
import { assertNoSplitOverlap, assertDuplicateFamiliesExcluded } from "../src/data/guards.js";
import { loadPredictorInputs } from "../src/data/predictorInput.js";
import { verifyMaterializedHashes, verifyPrivateArtifactHashes } from "../src/data/materializedHashes.js";
import type { SplitName } from "../src/contracts/types.js";

console.log("=== data:verify ===");

const hashResults = verifyManifestHashes();
for (const r of hashResults) {
  console.log(`  hash ${r.ok ? "OK  " : "FAIL"} ${r.file}`);
}
if (!hashResults.every((r) => r.ok)) {
  console.error("FAILED: manifest hash mismatch.");
  process.exit(1);
}

const train = loadGroundTruth("TRAIN");
const dev = loadGroundTruth("DEV");
const finalHoldout = loadGroundTruth("FINAL_HOLDOUT");

console.log(`  TRAIN: ${train.length} records`);
console.log(`  DEV: ${dev.length} records`);
console.log(`  FINAL_HOLDOUT: ${finalHoldout.length} records`);

assertNoSplitOverlap(train, dev, finalHoldout);
console.log("  OK   no split overlap");

assertDuplicateFamiliesExcluded(train, dev, finalHoldout);
console.log("  OK   duplicate families excluded");

console.log("--- materialized predictor-safe files (data/*.jsonl) ---");
const materializedHashCheck = verifyMaterializedHashes();
if (!materializedHashCheck.available) {
  console.log("  not yet materialized (run `npm run data:materialize`) — skipping.");
} else {
  for (const r of materializedHashCheck.results) {
    console.log(`  hash ${r.ok ? "OK  " : "FAIL"} ${r.file}`);
  }
  if (!materializedHashCheck.results.every((r) => r.ok)) {
    console.error("FAILED: materialized artifact hash mismatch.");
    process.exit(1);
  }

  for (const split of ["TRAIN", "DEV", "FINAL_HOLDOUT"] as const satisfies readonly SplitName[]) {
    const { available, extraNumbers, missingNumbers, records } = loadPredictorInputs(split);
    if (!available) {
      console.error(`FAILED: data/${split.toLowerCase()}.jsonl reported as materialized but failed to load.`);
      process.exit(1);
    }
    if (extraNumbers.length > 0 || missingNumbers.length > 0) {
      console.error(
        `FAILED: ${split} materialized issue-number set does not match the frozen manifest. ` +
          `extra=${extraNumbers.join(",")} missing=${missingNumbers.join(",")}`,
      );
      process.exit(1);
    }
    console.log(`  OK   ${split}: ${records.length} predictor-safe records, issue-number set matches manifest exactly`);
  }
}

console.log("--- evaluator-private local artifacts (data/private/, gitignored) ---");
const privateCheck = verifyPrivateArtifactHashes();
if (!privateCheck.available) {
  console.log("  not present in this checkout (expected unless you ran `npm run data:materialize` locally) — skipping.");
} else {
  for (const r of privateCheck.results) {
    console.log(`  hash ${r.ok ? "OK  " : "FAIL"} ${r.file}`);
  }
  if (!privateCheck.results.every((r) => r.ok)) {
    console.error("FAILED: private artifact hash mismatch.");
    process.exit(1);
  }
}

console.log("data:verify PASSED.");
