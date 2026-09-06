import { verifyManifestHashes } from "../src/data/manifests.js";

console.log(`Node: ${process.version}`);
console.log("Checking frozen manifest hashes...");
const results = verifyManifestHashes();
for (const r of results) {
  console.log(`  ${r.ok ? "OK  " : "FAIL"} ${r.file}`);
}
const allOk = results.every((r) => r.ok);
if (!allOk) {
  console.error("env:check FAILED — manifest hashes do not match the GATE 01C freeze record.");
  process.exit(1);
}
console.log("env:check OK — manifests intact.");
