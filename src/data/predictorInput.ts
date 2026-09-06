import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AuthorAssociation, PredictorInput, SplitName } from "../contracts/types.js";
import { loadGroundTruth } from "./manifests.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, "..", "..", "data");

/**
 * The ONLY keys a materialized dataset row may contribute to a PredictorInput.
 * Any other key present in a materialized row is dropped, never forwarded.
 * See EVAL_CONTRACT.md §12.6 (frozen predictor input contract).
 */
const ALLOWED_KEYS = ["title", "body", "createdAt", "authorAssociation"] as const;

interface RawMaterializedRow {
  number: number;
  title?: unknown;
  body?: unknown;
  createdAt?: unknown;
  authorAssociation?: unknown;
  // Any of these appearing here is a compliance violation if forwarded —
  // they are intentionally NOT in ALLOWED_KEYS and must never reach PredictorInput.
  label?: unknown;
  subtype?: unknown;
  stateReason?: unknown;
  closedAt?: unknown;
  labels?: unknown;
  milestone?: unknown;
  assignee?: unknown;
  comments?: unknown;
}

function jsonlPathFor(split: SplitName): string {
  const filename = split === "FINAL_HOLDOUT" ? "final_holdout.jsonl" : `${split.toLowerCase()}.jsonl`;
  return path.join(DATA_DIR, filename);
}

/**
 * Strips a raw materialized row down to exactly the allowed predictor-input
 * fields, dropping everything else (defense in depth — the caller should
 * never have handed us a row with more than this, but we never trust that).
 */
export function toPredictorInput(row: RawMaterializedRow): PredictorInput {
  const picked: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    picked[key] = (row as unknown as Record<string, unknown>)[key];
  }
  if (typeof picked.title !== "string" || typeof picked.body !== "string") {
    throw new Error(`Row ${row.number} missing required title/body string fields`);
  }
  if (typeof picked.createdAt !== "string") {
    throw new Error(`Row ${row.number} missing required createdAt string field`);
  }
  if (typeof picked.authorAssociation !== "string") {
    throw new Error(`Row ${row.number} missing required authorAssociation string field`);
  }
  return {
    title: picked.title,
    body: picked.body,
    createdAt: picked.createdAt,
    authorAssociation: picked.authorAssociation as AuthorAssociation,
  };
}

export interface PredictorInputRecord {
  readonly number: number;
  readonly input: PredictorInput;
}

/**
 * Loads predictor-safe inputs for a split from the materialized dataset
 * (data/{train,dev,final_holdout}.jsonl), which is produced by a later
 * gate (GATE 02, per docs/IMPLEMENTATION_PLAN.md) — not yet present as of
 * this gate. Returns an empty array with `available: false` if the file
 * does not exist yet, rather than throwing, so downstream plumbing (harness
 * wiring, tests) can be exercised before materialization lands.
 *
 * Verifies the loaded issue-number set is a subset of the frozen manifest
 * for this split — never more, and any set-inequality is surfaced via the
 * `extraNumbers`/`missingNumbers` diagnostics rather than silently ignored.
 */
export function loadPredictorInputs(split: SplitName): {
  available: boolean;
  records: PredictorInputRecord[];
  extraNumbers: number[];
  missingNumbers: number[];
} {
  const file = jsonlPathFor(split);
  if (!existsSync(file)) {
    return { available: false, records: [], extraNumbers: [], missingNumbers: [] };
  }
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const rows = lines.map((l) => JSON.parse(l) as RawMaterializedRow);
  const records = rows.map((r) => ({ number: r.number, input: toPredictorInput(r) }));

  const manifestNumbers = new Set(loadGroundTruth(split).map((g) => g.number));
  const loadedNumbers = new Set(records.map((r) => r.number));
  const extraNumbers = [...loadedNumbers].filter((n) => !manifestNumbers.has(n));
  const missingNumbers = [...manifestNumbers].filter((n) => !loadedNumbers.has(n));

  return { available: true, records, extraNumbers, missingNumbers };
}
