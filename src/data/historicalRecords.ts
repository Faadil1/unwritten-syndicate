import type { HistoricalRecord } from "../contracts/types.js";
import { filterToPastRecords } from "./guards.js";

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
