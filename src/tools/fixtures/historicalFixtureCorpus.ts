import type { HistoricalRecord } from "../../contracts/types.js";

/**
 * Small, deterministic FIXTURE historical corpus for wiring/testing the
 * historical-search tool before GATE 02 materializes `data/train.jsonl`.
 *
 * This is NOT real TRAIN data — do not use it to compute or report any
 * benchmark metric. Once `data/train.jsonl` exists,
 * `buildHistoricalSearchToolFromTrain` in `src/tools/historicalSearchTool.ts`
 * is the real-corpus integration point.
 */
export function buildFixtureHistoricalCorpus(): HistoricalRecord[] {
  return [
    {
      number: 101,
      title: "Fixture: crash on startup with default config",
      body: "Fixture body text — not real issue content.",
      createdAt: "2024-01-05T00:00:00Z",
      authorAssociation: "NONE",
      label: "RESOLVED_COMPLETED",
      subtype: "COMPLETED",
    },
    {
      number: 102,
      title: "Fixture: duplicate report of the startup crash",
      body: "Fixture body text — not real issue content.",
      createdAt: "2024-02-10T00:00:00Z",
      authorAssociation: "FIRST_TIME_CONTRIBUTOR",
      label: "RESOLVED_NO_NEW_WORK",
      subtype: "DUPLICATE",
    },
    {
      number: 103,
      title: "Fixture: feature request outside current scope",
      body: "Fixture body text — not real issue content.",
      createdAt: "2024-03-15T00:00:00Z",
      authorAssociation: "CONTRIBUTOR",
      label: "RESOLVED_NO_NEW_WORK",
      subtype: "NOT_PLANNED",
    },
    {
      number: 104,
      title: "Fixture: fixed parser bug",
      body: "Fixture body text — not real issue content.",
      createdAt: "2024-04-20T00:00:00Z",
      authorAssociation: "NONE",
      label: "RESOLVED_COMPLETED",
      subtype: "COMPLETED",
    },
    {
      number: 105,
      title: "Fixture: another fixed bug in the same area",
      body: "Fixture body text — not real issue content.",
      createdAt: "2024-05-25T00:00:00Z",
      authorAssociation: "NONE",
      label: "RESOLVED_COMPLETED",
      subtype: "COMPLETED",
    },
  ];
}
