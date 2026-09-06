import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { GroundTruth, SplitName } from "../contracts/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_DIR = path.resolve(HERE, "..", "..", "data", "gate01c_manifests");

export const MANIFEST_FILES = {
  TRAIN: "manifest_train.json",
  DEV: "manifest_dev.json",
  FINAL_HOLDOUT: "manifest_final_holdout.json",
} as const satisfies Record<SplitName, string>;

export const EXCLUDED_DUPLICATE_FAMILIES_FILE = "manifest_excluded_duplicate_families.json";

/**
 * Frozen SHA-256 hashes, GATE 01C freeze record.
 * Source of truth: data/gate01c_manifests/manifest_hashes.txt
 * Any mismatch means the on-disk manifest no longer matches the frozen
 * benchmark and must NOT be silently used.
 */
export const FROZEN_HASHES: Record<string, string> = {
  "manifest_train.json": "c243be0d21cf375b63d6474c99fb38d75613597d581ca30475882ab4c36d089a",
  "manifest_dev.json": "ac4e4e075f32d62689ac1bd9acf540a051588515798bf3c5c2684491a1eb7579",
  "manifest_final_holdout.json": "09a9a3077c27cb454b8733eccf248e2d9771fbdf82e40da84bd74cc38dd296f6",
  "manifest_excluded_duplicate_families.json":
    "2bd6ab925e731250713a1223e20be1e784e3a73662b776c273553cd61d92f09e",
};

export interface HashCheckResult {
  readonly file: string;
  readonly expected: string;
  readonly actual: string;
  readonly ok: boolean;
}

export function sha256File(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function verifyManifestHashes(): readonly HashCheckResult[] {
  return Object.entries(FROZEN_HASHES).map(([file, expected]) => {
    const abs = path.join(MANIFEST_DIR, file);
    const actual = sha256File(abs);
    return { file, expected, actual, ok: actual === expected };
  });
}

/**
 * Throws if any frozen manifest's on-disk hash does not match the frozen
 * record. Callers MUST call this before trusting any manifest contents.
 */
export function assertManifestsIntact(): void {
  const results = verifyManifestHashes();
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) {
    const detail = bad.map((r) => `  ${r.file}: expected ${r.expected}, got ${r.actual}`).join("\n");
    throw new Error(
      `Manifest integrity check FAILED for ${bad.length} file(s). The frozen benchmark ` +
        `must not be used if manifests have drifted from the GATE 01C freeze record:\n${detail}`,
    );
  }
}

interface RawManifestRecord {
  number: number;
  label: GroundTruth["label"];
  subtype: GroundTruth["subtype"];
  created_at: string;
}

function loadRawManifest(file: string): RawManifestRecord[] {
  const abs = path.join(MANIFEST_DIR, file);
  const parsed: unknown = JSON.parse(readFileSync(abs, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Manifest ${file} did not parse to an array`);
  }
  return parsed as RawManifestRecord[];
}

/** Loads a split's ground truth. Verifies hash integrity first. */
export function loadGroundTruth(split: SplitName): GroundTruth[] {
  assertManifestsIntact();
  const raw = loadRawManifest(MANIFEST_FILES[split]);
  return raw.map((r) => ({
    number: r.number,
    label: r.label,
    subtype: r.subtype,
    createdAt: r.created_at,
  }));
}

interface RawExcludedFamilies {
  reason: string;
  excluded_issue_numbers: number[];
}

export interface ExcludedDuplicateFamilies {
  readonly reason: string;
  readonly excludedIssueNumbers: readonly number[];
}

export function loadExcludedDuplicateFamilies(): ExcludedDuplicateFamilies {
  assertManifestsIntact();
  const abs = path.join(MANIFEST_DIR, EXCLUDED_DUPLICATE_FAMILIES_FILE);
  const parsed = JSON.parse(readFileSync(abs, "utf8")) as RawExcludedFamilies;
  return { reason: parsed.reason, excludedIssueNumbers: parsed.excluded_issue_numbers };
}
