import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HistoricalRecord } from "../contracts/types.js";
import { filterToPastRecords } from "./guards.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, "..", "..", "data");

function readJsonl(absPath: string): HistoricalRecord[] {
  const lines = readFileSync(absPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l) as HistoricalRecord);
}

/**
 * Loads the frozen TRAIN-only historical corpus (data/train_feedback.jsonl)
 * for use as the search pool when evaluating DEV. Per the historical-search
 * constraint (EVAL_CONTRACT.md §12.6) and this session's explicit scope
 * ("during DEV evaluation, historical search must use TRAIN outcomes only;
 * DEV outcomes must not become history for later DEV cases"), DEV-eval
 * history must never include any DEV or FINAL_HOLDOUT record — this loader
 * structurally guarantees that by only ever reading the TRAIN-only file.
 * Returns `available: false` if data/train_feedback.jsonl has not been
 * materialized yet, rather than fabricating a result.
 */
export function loadDevEvalHistoricalCorpus(): { available: boolean; records: HistoricalRecord[] } {
  const file = path.join(DATA_DIR, "train_feedback.jsonl");
  if (!existsSync(file)) return { available: false, records: [] };
  return { available: true, records: readJsonl(file) };
}

/**
 * Loads the TRAIN+DEV historical corpus for use as the search pool when
 * evaluating FINAL_HOLDOUT (both splits strictly precede FINAL_HOLDOUT
 * chronologically per the frozen split boundaries, EVAL_CONTRACT.md §13).
 * This corpus is the evaluator-private artifact
 * (data/private/history_train_dev_for_final.jsonl) because it is the first
 * artifact that joins DEV issue text to DEV's outcome — it is gitignored
 * and regenerated locally by `npm run data:materialize`, never committed.
 * Returns `available: false` if it is not present in this checkout (the
 * expected state for anyone other than the evaluator who generated it).
 */
export function loadFinalEvalHistoricalCorpus(): { available: boolean; records: HistoricalRecord[] } {
  const file = path.join(DATA_DIR, "private", "history_train_dev_for_final.jsonl");
  if (!existsSync(file)) return { available: false, records: [] };
  return { available: true, records: readJsonl(file) };
}

/**
 * In-memory historical-record store, indexed by number and sorted by
 * createdAt ascending. This is the plumbing consumed by A1's raw-RAG
 * baseline and any future rule-learning worker's retrieval tool — it does
 * NOT itself decide relevance/similarity, only enforces the temporal
 * contract and provides basic lookup.
 *
 * Never construct a HistoricalRecordStore over FINAL_HOLDOUT-only content
 * for a predictor path — TRAIN (and, once frozen post-DEV-iteration, DEV)
 * is the intended source pool. See EVAL_CONTRACT.md §12.6.
 */
export class HistoricalRecordStore {
  private readonly byCreatedAt: HistoricalRecord[];

  constructor(records: readonly HistoricalRecord[]) {
    this.byCreatedAt = [...records].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  }

  get size(): number {
    return this.byCreatedAt.length;
  }

  /**
   * Returns all stored records with createdAt strictly before `currentCreatedAt`.
   * This is the only retrieval primitive exposed — every caller goes through
   * the temporal filter, so it is structurally impossible to retrieve a
   * future record via this store.
   */
  findPast(currentCreatedAt: string): HistoricalRecord[] {
    return filterToPastRecords(this.byCreatedAt, currentCreatedAt);
  }

  /**
   * Returns up to `k` past records, most-recent-first, as a simple
   * recency-based baseline retriever for A1 (raw-RAG). Real similarity
   * ranking is out of scope for this layer.
   */
  findRecentPast(currentCreatedAt: string, k: number): HistoricalRecord[] {
    const past = this.findPast(currentCreatedAt);
    return past.slice(-k).reverse();
  }
}
