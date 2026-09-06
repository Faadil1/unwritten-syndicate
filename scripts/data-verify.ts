import { verifyManifestHashes, loadGroundTruth } from "../src/data/manifests.js";
import { assertNoSplitOverlap, assertDuplicateFamiliesExcluded } from "../src/data/guards.js";

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

console.log("data:verify PASSED.");
