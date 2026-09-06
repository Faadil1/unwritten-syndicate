import type { HistoricalRecord } from "../contracts/types.js";
import { HistoricalRecordStore } from "../data/historicalRecords.js";
import { assertAllPast } from "../data/guards.js";
import { loadGroundTruth } from "../data/manifests.js";
import { loadPredictorInputs } from "../data/predictorInput.js";
import { ToolCallRecorder } from "../instrumentation/toolInstrumentation.js";

/**
 * Where a historical-search corpus's records legitimately came from.
 *
 * "DEV" and "FINAL_HOLDOUT" are deliberately NOT valid values here: this
 * benchmark forbids using DEV's own resolution outcomes as historical
 * "ground truth" context while iterating/evaluating on DEV — a stronger
 * rule than src/eval/groundTruthAccess.ts's FINAL_HOLDOUT-only token gate —
 * and FINAL_HOLDOUT truth must never be read by a tool-policy code path at
 * all. Only the frozen TRAIN corpus, or local FIXTURE data, may back a
 * historical-search corpus.
 */
export type CorpusProvenance = "TRAIN" | "FIXTURE";

const ALLOWED_PROVENANCE: ReadonlySet<string> = new Set<CorpusProvenance>(["TRAIN", "FIXTURE"]);

export function assertValidCorpusProvenance(provenance: string): asserts provenance is CorpusProvenance {
  if (!ALLOWED_PROVENANCE.has(provenance)) {
    throw new Error(
      `Historical-search corpus provenance "${provenance}" is not allowed. Only "TRAIN" (frozen ` +
        `historical ground truth) or "FIXTURE" (local test/dev data) may back a historical-search ` +
        `corpus — DEV and FINAL_HOLDOUT outcomes must never be used as historical ground truth.`,
    );
  }
}

export interface HistoricalSearchResultRecord {
  /** The historical issue number this record came from — its provenance ID. */
  readonly sourceId: number;
  readonly createdAt: string;
  readonly title: string;
  readonly body: string;
  readonly label: HistoricalRecord["label"];
  readonly subtype: HistoricalRecord["subtype"];
}

export interface HistoricalSearchResult {
  readonly query: {
    readonly currentCreatedAt: string;
    readonly requestedTopK: number;
  };
  readonly corpusProvenance: CorpusProvenance;
  readonly resultCount: number;
  readonly records: readonly HistoricalSearchResultRecord[];
}

export interface HistoricalSearchToolOptions {
  readonly recorder?: ToolCallRecorder;
}

/**
 * LOCAL historical-search tool over a frozen (TRAIN) or fixture historical
 * corpus. No live GitHub access, ever — see EVAL_CONTRACT.md §12.6 and the
 * DEV/FINAL ground-truth-isolation rule documented on `CorpusProvenance`.
 *
 * Every call performs temporal filtering BEFORE ranking/return (delegated to
 * `HistoricalRecordStore.findRecentPast`, which sorts once at construction
 * and slices deterministically), and re-verifies the result via
 * `assertAllPast` before returning — so the same
 * (corpus, currentCreatedAt, topK) triple always returns the same fixed
 * top-k in the same order, and a future regression in the store cannot
 * silently leak a future/equal-time record through this tool.
 */
export class HistoricalSearchTool {
  readonly corpusProvenance: CorpusProvenance;
  readonly corpusSize: number;
  private readonly store: HistoricalRecordStore;
  private readonly recorder: ToolCallRecorder;

  constructor(
    records: readonly HistoricalRecord[],
    corpusProvenance: string,
    options: HistoricalSearchToolOptions = {},
  ) {
    assertValidCorpusProvenance(corpusProvenance);
    this.corpusProvenance = corpusProvenance;
    this.store = new HistoricalRecordStore(records);
    this.corpusSize = this.store.size;
    this.recorder = options.recorder ?? new ToolCallRecorder();
  }

  /** Instrumentation for every call made through this tool instance. */
  get instrumentation(): ToolCallRecorder {
    return this.recorder;
  }

  async search(currentCreatedAt: string, topK: number): Promise<HistoricalSearchResult> {
    return this.recorder.record(
      "historical_search",
      () => {
        const found = this.store.findRecentPast(currentCreatedAt, topK);
        assertAllPast(found, currentCreatedAt);
        const records: HistoricalSearchResultRecord[] = found.map((r) => ({
          sourceId: r.number,
          createdAt: r.createdAt,
          title: r.title,
          body: r.body,
          label: r.label,
          subtype: r.subtype,
        }));
        const result: HistoricalSearchResult = {
          query: { currentCreatedAt, requestedTopK: topK },
          corpusProvenance: this.corpusProvenance,
          resultCount: records.length,
          records,
        };
        return result;
      },
      { resultCount: (output) => output.resultCount, tokenUsage: null },
    );
  }
}

export interface TrainCorpusLoadResult {
  readonly available: boolean;
  readonly tool?: HistoricalSearchTool;
  /** TRAIN-manifest issue numbers whose materialized row had no matching ground truth. */
  readonly missingNumbers: readonly number[];
}

/**
 * Builds a HistoricalSearchTool from the materialized TRAIN dataset
 * (`data/train.jsonl` + the frozen TRAIN manifest), once GATE 02 lands it.
 * Returns `{ available: false }` rather than fabricating a corpus if
 * `data/train.jsonl` does not exist yet — mirrors
 * `loadPredictorInputs`'s existing not-yet-materialized pattern (see
 * src/data/predictorInput.ts). Only ever reads TRAIN — never DEV or
 * FINAL_HOLDOUT — so this cannot violate the DEV/FINAL ground-truth
 * isolation rule even by accident.
 */
export function buildHistoricalSearchToolFromTrain(
  options: HistoricalSearchToolOptions = {},
): TrainCorpusLoadResult {
  const loaded = loadPredictorInputs("TRAIN");
  if (!loaded.available) {
    return { available: false, missingNumbers: [] };
  }
  const truthByNumber = new Map(loadGroundTruth("TRAIN").map((g) => [g.number, g]));
  const records: HistoricalRecord[] = [];
  const missingNumbers: number[] = [];
  for (const rec of loaded.records) {
    const truth = truthByNumber.get(rec.number);
    if (!truth) {
      missingNumbers.push(rec.number);
      continue;
    }
    records.push({
      number: rec.number,
      title: rec.input.title,
      body: rec.input.body,
      createdAt: rec.input.createdAt,
      authorAssociation: rec.input.authorAssociation,
      label: truth.label,
      subtype: truth.subtype,
    });
  }
  return {
    available: true,
    tool: new HistoricalSearchTool(records, "TRAIN", options),
    missingNumbers,
  };
}
