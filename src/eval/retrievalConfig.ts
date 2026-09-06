/**
 * Frozen historical-search retrieval configuration for the DEV A0-A3
 * bakeoff (see docs/AO_BUILD_LEDGER.md integration notes). A1 (raw-RAG) and
 * A3 (real learned Rulebook) MUST both retrieve from this exact
 * (corpus, temporal filter, top-k, ranking) configuration — the only
 * permitted difference between A1 and A3 is Rulebook/tool-policy behavior
 * (see src/rulebook/toolHeuristicAdapter.ts), never a better or different
 * retrieval setup. Changing this value changes the bakeoff for every arm
 * that reads it, never just one.
 */

/** Corpus: TRAIN-only (src/data/historicalRecords.ts loadDevEvalHistoricalCorpus). */
/** Temporal filter: HistoricalRecordStore.findRecentPast (strict createdAt < current.createdAt). */
/** Ranking: most-recent-first (see HistoricalRecordStore.findRecentPast). */
export const DEV_HISTORICAL_SEARCH_TOP_K = 5;
