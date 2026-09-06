import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./manifests.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(HERE, "..", "..", "data");
export const PRIVATE_DIR = path.join(DATA_DIR, "private");

export const MATERIALIZED_HASHES_FILE = path.join(DATA_DIR, "materialized_hashes.json");
export const PRIVATE_ARTIFACTS_MANIFEST_FILE = path.join(DATA_DIR, "private_artifacts_manifest.json");

interface MaterializedEntry {
  records: number;
  sha256: string;
}

interface PrivateEntry {
  path: string;
  records: number;
  sha256: string;
}

export interface HashCheckResult {
  readonly file: string;
  readonly expected: string;
  readonly actual: string;
  readonly ok: boolean;
}

/**
 * Verifies data/train.jsonl, data/dev.jsonl, data/final_holdout.jsonl, and
 * data/train_feedback.jsonl against the hashes frozen at materialization
 * time (data/materialized_hashes.json). Returns `available: false` (rather
 * than throwing) if the materialized files don't exist yet in this
 * checkout — mirrors loadPredictorInputs' "don't fabricate a result"
 * convention.
 */
export function verifyMaterializedHashes(): { available: boolean; results: HashCheckResult[] } {
  if (!existsSync(MATERIALIZED_HASHES_FILE)) {
    return { available: false, results: [] };
  }
  const recorded = JSON.parse(readFileSync(MATERIALIZED_HASHES_FILE, "utf8")) as Record<
    string,
    MaterializedEntry
  >;
  const results = Object.entries(recorded).map(([file, entry]) => {
    const abs = path.join(DATA_DIR, file);
    const actual = existsSync(abs) ? sha256File(abs) : "<file missing>";
    return { file, expected: entry.sha256, actual, ok: actual === entry.sha256 };
  });
  return { available: true, results };
}

/**
 * Verifies the evaluator-private, gitignored artifacts under data/private/
 * against data/private_artifacts_manifest.json. These files are generated
 * locally by `npm run data:materialize` and are NOT committed, so a fresh
 * checkout of this branch will legitimately not have them — callers must
 * treat `available: false` as expected, not as failure.
 */
export function verifyPrivateArtifactHashes(): { available: boolean; results: HashCheckResult[] } {
  if (!existsSync(PRIVATE_ARTIFACTS_MANIFEST_FILE)) {
    return { available: false, results: [] };
  }
  const recorded = JSON.parse(readFileSync(PRIVATE_ARTIFACTS_MANIFEST_FILE, "utf8")) as Record<
    string,
    PrivateEntry
  >;
  const results = Object.entries(recorded).map(([file, entry]) => {
    const abs = path.resolve(DATA_DIR, "..", entry.path);
    const actual = existsSync(abs) ? sha256File(abs) : "<file missing>";
    return { file, expected: entry.sha256, actual, ok: actual === entry.sha256 };
  });
  return { available: true, results };
}
