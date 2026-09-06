import { describe, expect, it } from "vitest";
import { toPredictorInput } from "../../src/data/predictorInput.js";

const ALLOWED = new Set(["title", "body", "createdAt", "authorAssociation"]);

describe("hard input boundary: PredictorInput cannot expose GroundTruth", () => {
  const dirtyRow = {
    number: 123,
    title: "some issue",
    body: "some body",
    createdAt: "2025-01-01T00:00:00Z",
    authorAssociation: "NONE" as const,
    // fields that must NEVER survive into PredictorInput:
    label: "RESOLVED_COMPLETED",
    subtype: "COMPLETED",
    stateReason: "COMPLETED",
    closedAt: "2025-02-01T00:00:00Z",
    labels: ["bug"],
    milestone: "v3",
    assignee: "someone",
    comments: ["a comment"],
  };

  it("only ever produces the four allowed keys", () => {
    const input = toPredictorInput(dirtyRow);
    expect(Object.keys(input).sort()).toEqual([...ALLOWED].sort());
  });

  it("drops label/subtype/stateReason/closedAt/labels/milestone/assignee/comments entirely", () => {
    const input = toPredictorInput(dirtyRow) as unknown as Record<string, unknown>;
    for (const forbidden of [
      "label",
      "subtype",
      "stateReason",
      "closedAt",
      "labels",
      "milestone",
      "assignee",
      "comments",
    ]) {
      expect(input[forbidden]).toBeUndefined();
    }
  });

  it("round-trips the four legitimate fields unchanged", () => {
    const input = toPredictorInput(dirtyRow);
    expect(input.title).toBe(dirtyRow.title);
    expect(input.body).toBe(dirtyRow.body);
    expect(input.createdAt).toBe(dirtyRow.createdAt);
    expect(input.authorAssociation).toBe(dirtyRow.authorAssociation);
  });

  it("throws rather than silently coercing a missing required field", () => {
    const incomplete = { number: 1, title: "t", body: "b", createdAt: "2025-01-01T00:00:00Z" };
    expect(() => toPredictorInput(incomplete)).toThrow(/authorAssociation/);
  });

  it("JSON round-trip of a PredictorInput exposes no forbidden keys either", () => {
    const input = toPredictorInput(dirtyRow);
    const serialized = JSON.parse(JSON.stringify(input));
    expect(Object.keys(serialized).sort()).toEqual([...ALLOWED].sort());
  });
});
