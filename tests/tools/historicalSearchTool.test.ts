import { describe, expect, it } from "vitest";
import {
  HistoricalSearchTool,
  assertValidCorpusProvenance,
  buildHistoricalSearchToolFromTrain,
} from "../../src/tools/historicalSearchTool.js";
import { buildFixtureHistoricalCorpus } from "../../src/tools/fixtures/historicalFixtureCorpus.js";
import { ToolCallRecorder } from "../../src/instrumentation/toolInstrumentation.js";

describe("HistoricalSearchTool — temporal safety", () => {
  it("never returns a record with createdAt >= the current issue's createdAt", async () => {
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE");
    const result = await tool.search("2024-03-15T00:00:00Z", 10); // exactly equal to #103's createdAt
    expect(result.records.every((r) => Date.parse(r.createdAt) < Date.parse("2024-03-15T00:00:00Z"))).toBe(
      true,
    );
    expect(result.records.map((r) => r.sourceId)).not.toContain(103);
  });

  it("returns nothing when the current issue precedes the entire corpus", async () => {
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE");
    const result = await tool.search("2020-01-01T00:00:00Z", 10);
    expect(result.records).toEqual([]);
    expect(result.resultCount).toBe(0);
  });
});

describe("HistoricalSearchTool — deterministic fixed top-k", () => {
  it("returns the same ordered result across repeated identical calls", async () => {
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE");
    const first = await tool.search("2024-12-31T00:00:00Z", 2);
    const second = await tool.search("2024-12-31T00:00:00Z", 2);
    expect(second.records).toEqual(first.records);
    expect(first.records.map((r) => r.sourceId)).toEqual([105, 104]); // most-recent-first, capped at k
  });

  it("caps at the requested topK even when more past records are available", async () => {
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE");
    const result = await tool.search("2024-12-31T00:00:00Z", 1);
    expect(result.records).toHaveLength(1);
    expect(result.resultCount).toBe(1);
  });
});

describe("HistoricalSearchTool — source/provenance IDs and result counts", () => {
  it("every returned record carries its originating issue number as sourceId", async () => {
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE");
    const result = await tool.search("2024-12-31T00:00:00Z", 10);
    expect(result.records.every((r) => typeof r.sourceId === "number")).toBe(true);
    expect(result.corpusProvenance).toBe("FIXTURE");
  });

  it("resultCount always equals records.length", async () => {
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE");
    for (const [createdAt, k] of [
      ["2024-12-31T00:00:00Z", 10] as const,
      ["2024-01-01T00:00:00Z", 10] as const,
      ["2024-12-31T00:00:00Z", 2] as const,
    ]) {
      const result = await tool.search(createdAt, k);
      expect(result.resultCount).toBe(result.records.length);
    }
  });
});

describe("HistoricalSearchTool — corpus provenance guard (DEV/FINAL isolation)", () => {
  it("accepts TRAIN and FIXTURE", () => {
    expect(() => assertValidCorpusProvenance("TRAIN")).not.toThrow();
    expect(() => assertValidCorpusProvenance("FIXTURE")).not.toThrow();
  });

  it("rejects DEV as a corpus provenance", () => {
    expect(() => new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "DEV")).toThrow(
      /must never be used as historical ground truth/,
    );
  });

  it("rejects FINAL_HOLDOUT as a corpus provenance", () => {
    expect(() => new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FINAL_HOLDOUT")).toThrow(
      /must never be used as historical ground truth/,
    );
  });

  it("rejects an arbitrary/unknown provenance string", () => {
    expect(() => new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "LIVE_GITHUB")).toThrow();
  });
});

describe("HistoricalSearchTool — instrumentation", () => {
  it("records a call-sequence entry per search(), in order", async () => {
    const recorder = new ToolCallRecorder();
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE", { recorder });
    await tool.search("2024-12-31T00:00:00Z", 2);
    await tool.search("2024-02-01T00:00:00Z", 2);
    expect(recorder.callSequence).toEqual(["historical_search", "historical_search"]);
  });

  it("records resultCount and non-negative latency for each call", async () => {
    const recorder = new ToolCallRecorder();
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE", { recorder });
    await tool.search("2024-12-31T00:00:00Z", 2);
    const trace = recorder.all[0]!;
    expect(trace.resultCount).toBe(2);
    expect(trace.error).toBeNull();
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("never fabricates token usage — stays null since this tool exposes no token API", async () => {
    const recorder = new ToolCallRecorder();
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE", { recorder });
    await tool.search("2024-12-31T00:00:00Z", 2);
    expect(recorder.all[0]!.tokenUsage).toBeNull();
  });

  it("records an error trace if the store is asked with an invalid date, without silently losing the call", async () => {
    const recorder = new ToolCallRecorder();
    const tool = new HistoricalSearchTool(buildFixtureHistoricalCorpus(), "FIXTURE", { recorder });
    await expect(tool.search("not-a-date", 2)).rejects.toThrow();
    expect(recorder.all).toHaveLength(1);
    expect(recorder.all[0]!.error).not.toBeNull();
  });
});

describe("HistoricalSearchTool — no live GitHub, fixtures until materialization", () => {
  it("buildHistoricalSearchToolFromTrain reports unavailable rather than fetching live data (data/train.jsonl not yet materialized)", () => {
    const result = buildHistoricalSearchToolFromTrain();
    expect(result.available).toBe(false);
    expect(result.tool).toBeUndefined();
  });
});
