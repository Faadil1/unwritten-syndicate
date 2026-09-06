import { describe, expect, it } from "vitest";
import { runA0Cold, makeA1Predictor, makeA2Predictor } from "../../src/eval/harness.js";
import { HistoricalRecordStore } from "../../src/data/historicalRecords.js";
import type { HistoricalRecord, PredictorInput, RulebookSnapshot } from "../../src/contracts/types.js";

function item(number: number, createdAt: string): { number: number; input: PredictorInput } {
  return {
    number,
    input: { title: `t${number}`, body: `b${number}`, createdAt, authorAssociation: "NONE" },
  };
}

describe("evaluation isolation", () => {
  it("one predictor failure does not block scoring of other items", async () => {
    const items = [item(1, "2025-01-01T00:00:00Z"), item(2, "2025-01-02T00:00:00Z"), item(3, "2025-01-03T00:00:00Z")];
    const predictions = await runA0Cold((input) => {
      if (input.title === "t2") throw new Error("boom");
      return "RESOLVED_COMPLETED";
    }, items);

    expect(predictions).toHaveLength(3);
    expect(predictions.find((p) => p.number === 2)?.error).toBe("boom");
    expect(predictions.find((p) => p.number === 1)?.error).toBeUndefined();
    expect(predictions.find((p) => p.number === 3)?.error).toBeUndefined();
  });

  it("predictor cannot mutate the shared input object across calls", async () => {
    const items = [item(1, "2025-01-01T00:00:00Z"), item(2, "2025-01-02T00:00:00Z")];
    await runA0Cold((input) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => ((input as any).title = "tampered")).toThrow();
      return "RESOLVED_COMPLETED";
    }, items);
  });
});

describe("A1 raw-RAG plumbing", () => {
  it("supplies only past records within topK to the predictor", async () => {
    const store = new HistoricalRecordStore([
      historical(1, "2024-01-01T00:00:00Z"),
      historical(2, "2024-06-01T00:00:00Z"),
      historical(3, "2025-01-01T00:00:00Z"),
    ]);
    const currentItem = item(99, "2024-12-01T00:00:00Z");
    let seenHistory: readonly HistoricalRecord[] = [];
    const predictor = makeA1Predictor(store, 5, (_input, history) => {
      seenHistory = history;
      return "RESOLVED_COMPLETED";
    });
    await runA0Cold(predictor, [currentItem]);
    expect(seenHistory.map((h) => h.number)).toEqual([2, 1]); // #3 is in the future, excluded
  });
});

describe("A2 scrambled-rulebook plumbing", () => {
  it("supplies a scrambled rulebook, not the original, to the predictor", async () => {
    const rulebook: RulebookSnapshot = {
      version: "V3",
      rules: [
        { id: "r1", recommendedBehavior: "A" },
        { id: "r2", recommendedBehavior: "B" },
        { id: "r3", recommendedBehavior: "C" },
        { id: "r4", recommendedBehavior: "D" },
        { id: "r5", recommendedBehavior: "E" },
      ],
    };
    let seenRulebook: RulebookSnapshot | undefined;
    const predictor = makeA2Predictor(rulebook, "seed-1", (_input, scrambled) => {
      seenRulebook = scrambled;
      return "RESOLVED_COMPLETED";
    });
    await runA0Cold(predictor, [item(1, "2025-01-01T00:00:00Z")]);
    expect(seenRulebook).toBeDefined();
    expect(seenRulebook!.rules.map((r) => r.id)).toEqual(rulebook.rules.map((r) => r.id));
  });
});

function historical(number: number, createdAt: string): HistoricalRecord {
  return {
    number,
    title: `h${number}`,
    body: "body",
    createdAt,
    authorAssociation: "NONE",
    label: "RESOLVED_COMPLETED",
    subtype: "COMPLETED",
  };
}
