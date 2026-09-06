import { describe, expect, it } from "vitest";
import { filterToPastRecords, assertAllPast } from "../../src/data/guards.js";
import { HistoricalRecordStore } from "../../src/data/historicalRecords.js";
import type { HistoricalRecord } from "../../src/contracts/types.js";

function rec(number: number, createdAt: string): HistoricalRecord {
  return {
    number,
    title: `issue ${number}`,
    body: "body",
    createdAt,
    authorAssociation: "NONE",
    label: "RESOLVED_COMPLETED",
    subtype: "COMPLETED",
  };
}

describe("historical search contract (no future records)", () => {
  const records = [
    rec(1, "2025-01-01T00:00:00Z"),
    rec(2, "2025-06-01T00:00:00Z"),
    rec(3, "2026-01-01T00:00:00Z"),
  ];

  it("filterToPastRecords excludes records at or after the current issue's createdAt", () => {
    const past = filterToPastRecords(records, "2025-06-01T00:00:00Z");
    expect(past.map((r) => r.number)).toEqual([1]);
  });

  it("filterToPastRecords excludes nothing when current is after all records", () => {
    const past = filterToPastRecords(records, "2027-01-01T00:00:00Z");
    expect(past.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("assertAllPast throws when given a record at/after cutoff", () => {
    expect(() => assertAllPast(records, "2025-06-01T00:00:00Z")).toThrow(/Future-record guard/);
  });

  it("assertAllPast passes when all records are strictly before cutoff", () => {
    expect(() => assertAllPast(records, "2027-01-01T00:00:00Z")).not.toThrow();
  });

  it("HistoricalRecordStore.findPast never returns a record >= current issue's createdAt", () => {
    const store = new HistoricalRecordStore(records);
    for (const probe of ["2025-01-01T00:00:00Z", "2025-06-01T00:00:00Z", "2026-06-01T00:00:00Z"]) {
      const found = store.findPast(probe);
      expect(() => assertAllPast(found, probe)).not.toThrow();
    }
  });

  it("HistoricalRecordStore.findRecentPast respects k and temporal ordering", () => {
    const store = new HistoricalRecordStore(records);
    const found = store.findRecentPast("2026-06-01T00:00:00Z", 2);
    expect(found.map((r) => r.number)).toEqual([3, 2]); // most recent first
  });

  it("rejects an invalid createdAt on the current issue", () => {
    expect(() => filterToPastRecords(records, "not-a-date")).toThrow(/Invalid currentCreatedAt/);
  });
});
