import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadGroundTruth, loadExcludedDuplicateFamilies } from "../src/data/manifests.js";
import {
  DATA_DIR,
  PRIVATE_DIR,
  fetchAllIssues,
  joinSplit,
  writeJsonl,
  sha256Of,
} from "./materialize-dataset.js";

/**
 * SESSION E — DEV-only evaluator-private ground-truth materializer.
 *
 * The full materializer (scripts/materialize-dataset.ts) joins TRAIN, DEV,
 * AND FINAL_HOLDOUT in one run and writes FINAL_HOLDOUT's private ground
 * truth as a side effect. That is disallowed here: FINAL_HOLDOUT is LOCKED
 * for this session (SESSION E task lock — do not read/score/infer/
 * materialize/inspect/fetch/generate FINAL ground truth).
 *
 * This script only ever loads and joins the DEV manifest. It never calls
 * `loadGroundTruth("FINAL_HOLDOUT")` and never writes anything under a
 * "final" name. It reuses `fetchAllIssues()` (the same read-only,
 * unauthenticated, paginated GitHub REST listing already used by the full
 * materializer) purely to stay inside the unauthenticated rate limit —
 * fetching each of the 66 DEV issues individually would cost 66 requests
 * against a 60/hour unauthenticated budget, whereas the paginated listing
 * costs ~12. The extra (non-DEV) issues returned by that listing are held
 * in memory only for the join lookup and are discarded; nothing about
 * TRAIN or FINAL_HOLDOUT is written anywhere.
 */

async function main(): Promise<void> {
  console.log("=== data:materialize:dev-only (SESSION E, DEV ground truth only) ===");

  const excluded = new Set(loadExcludedDuplicateFamilies().excludedIssueNumbers);
  const dev = loadGroundTruth("DEV");

  const violating = dev.filter((g) => excluded.has(g.number));
  if (violating.length > 0) {
    throw new Error("DEV manifest contains excluded duplicate-family issue number(s), refusing to proceed");
  }
  if (dev.length !== 66) {
    throw new Error(`DEV manifest expected exactly 66 records, found ${dev.length}. Refusing to proceed.`);
  }

  console.log(`Loaded frozen DEV ground truth: ${dev.length} records (FINAL_HOLDOUT and TRAIN manifests untouched)`);
  console.log("Fetching issue corpus from GitHub REST API (read-only, unauthenticated) for DEV join only...");
  const fetched = await fetchAllIssues();
  console.log(`Fetched ${fetched.size} non-PR issues total (used only to look up the 66 DEV issue numbers).`);

  const errors: string[] = [];
  const devJoined = joinSplit("DEV", dev, fetched, errors);

  if (errors.length > 0) {
    console.error(`data:materialize:dev-only FAILED — ${errors.length} integrity violation(s). No files written.`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  if (devJoined.length !== 66) {
    console.error(`data:materialize:dev-only FAILED — joined ${devJoined.length} DEV records, expected exactly 66.`);
    process.exit(1);
  }

  const byNumberAsc = (a: { number: number }, b: { number: number }) => a.number - b.number;
  const toGroundTruthJoined = (r: (typeof devJoined)[number]) => ({
    number: r.number,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorAssociation: r.authorAssociation,
    label: r.label,
    subtype: r.subtype,
    closedAt: r.closedAt,
    sourceUrl: r.sourceUrl,
  });

  mkdirSync(PRIVATE_DIR, { recursive: true });
  const devGroundTruthPath = path.join(PRIVATE_DIR, "dev_ground_truth.jsonl");
  writeJsonl(devGroundTruthPath, [...devJoined].sort(byNumberAsc).map(toGroundTruthJoined));

  const sha256 = sha256Of(devGroundTruthPath);

  // Merge only the dev_ground_truth entry into the committed manifest;
  // leave any existing final_holdout_ground_truth / history_train_dev_for_final
  // entries exactly as they were (this script never computes those values).
  const manifestPath = path.join(DATA_DIR, "private_artifacts_manifest.json");
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = {};
  }
  manifest["dev_ground_truth.jsonl"] = {
    path: "data/private/dev_ground_truth.jsonl",
    records: devJoined.length,
    sha256,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("data:materialize:dev-only PASSED.");
  console.log(`  data/private/dev_ground_truth.jsonl: ${devJoined.length} records (LOCAL ONLY, gitignored)`);
  console.log(`  sha256: ${sha256}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
