import { describe, expect, it } from "vitest";
import {
  PASSTHROUGH_TOOL_HEURISTICS,
  evaluateToolHeuristics,
  type ToolHeuristicContext,
  type ToolHeuristicHooks,
} from "../../src/tools/toolHeuristics.js";
import type { PredictorInput } from "../../src/contracts/types.js";

function ctx(overrides: Partial<ToolHeuristicContext> = {}): ToolHeuristicContext {
  const input: PredictorInput = {
    title: "t",
    body: "b",
    createdAt: "2025-01-01T00:00:00Z",
    authorAssociation: "NONE",
  };
  return {
    input,
    searchesPerformedSoFar: 0,
    lastResultCount: null,
    currentConfidence: null,
    ...overrides,
  };
}

describe("PASSTHROUGH_TOOL_HEURISTICS (mechanical default, not a learned policy)", () => {
  it("shouldSearch always returns SEARCH", () => {
    expect(PASSTHROUGH_TOOL_HEURISTICS.shouldSearch(ctx()).action).toBe("SEARCH");
  });

  it("all four hooks return a decision regardless of context", () => {
    const heavySearchCtx = ctx({ searchesPerformedSoFar: 50, currentConfidence: 0.99 });
    for (const hook of [
      PASSTHROUGH_TOOL_HEURISTICS.shouldSearch,
      PASSTHROUGH_TOOL_HEURISTICS.isHighConfidenceSufficient,
      PASSTHROUGH_TOOL_HEURISTICS.isFurtherSearchUnlikelyToHelp,
      PASSTHROUGH_TOOL_HEURISTICS.shouldAbstainOrEscalate,
    ] as const) {
      const decision = hook(heavySearchCtx);
      expect(typeof decision.action).toBe("string");
      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluateToolHeuristics", () => {
  it("exposes a hook point for each of the four required policy questions", () => {
    // A fake, per-hook-distinguishable implementation proves the four
    // required decision points (search-needed, confidence-sufficient,
    // further-search-unlikely, abstain/escalate) are independently wired,
    // without this layer inventing any of the actual learned logic.
    const fakeHooks: ToolHeuristicHooks = {
      shouldSearch: () => ({ action: "SEARCH", reason: "fake: search needed" }),
      isHighConfidenceSufficient: () => ({
        action: "HIGH_CONFIDENCE_SUFFICIENT",
        reason: "fake: confidence sufficient",
      }),
      isFurtherSearchUnlikelyToHelp: () => ({
        action: "FURTHER_SEARCH_UNLIKELY_TO_HELP",
        reason: "fake: further search unlikely to help",
      }),
      shouldAbstainOrEscalate: () => ({
        action: "ABSTAIN_OR_ESCALATE",
        reason: "fake: abstain or escalate",
      }),
    };

    const evaluation = evaluateToolHeuristics(fakeHooks, ctx());

    expect(evaluation.shouldSearch.action).toBe("SEARCH");
    expect(evaluation.isHighConfidenceSufficient.action).toBe("HIGH_CONFIDENCE_SUFFICIENT");
    expect(evaluation.isFurtherSearchUnlikelyToHelp.action).toBe("FURTHER_SEARCH_UNLIKELY_TO_HELP");
    expect(evaluation.shouldAbstainOrEscalate.action).toBe("ABSTAIN_OR_ESCALATE");
  });

  it("passes the same context through to every hook", () => {
    const seenContexts: ToolHeuristicContext[] = [];
    const recordingHooks: ToolHeuristicHooks = {
      shouldSearch: (c) => {
        seenContexts.push(c);
        return { action: "SEARCH", reason: "r" };
      },
      isHighConfidenceSufficient: (c) => {
        seenContexts.push(c);
        return { action: "SEARCH", reason: "r" };
      },
      isFurtherSearchUnlikelyToHelp: (c) => {
        seenContexts.push(c);
        return { action: "SEARCH", reason: "r" };
      },
      shouldAbstainOrEscalate: (c) => {
        seenContexts.push(c);
        return { action: "SEARCH", reason: "r" };
      },
    };
    const theContext = ctx({ searchesPerformedSoFar: 2, lastResultCount: 5 });
    evaluateToolHeuristics(recordingHooks, theContext);
    expect(seenContexts).toHaveLength(4);
    for (const seen of seenContexts) {
      expect(seen).toBe(theContext);
    }
  });
});
