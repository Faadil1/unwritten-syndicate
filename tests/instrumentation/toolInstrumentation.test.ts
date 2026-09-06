import { describe, expect, it } from "vitest";
import { ToolCallRecorder } from "../../src/instrumentation/toolInstrumentation.js";

describe("ToolCallRecorder", () => {
  it("records tool name, sequence index, and result count on success", async () => {
    const recorder = new ToolCallRecorder();
    const output = await recorder.record("search_tool", () => ["a", "b", "c"], {
      resultCount: (out) => out.length,
    });
    expect(output).toEqual(["a", "b", "c"]);
    expect(recorder.all).toHaveLength(1);
    const trace = recorder.all[0]!;
    expect(trace.tool).toBe("search_tool");
    expect(trace.sequenceIndex).toBe(0);
    expect(trace.resultCount).toBe(3);
    expect(trace.error).toBeNull();
  });

  it("records call sequence across multiple distinct tools in call order", async () => {
    const recorder = new ToolCallRecorder();
    await recorder.record("tool_a", () => 1);
    await recorder.record("tool_b", () => 2);
    await recorder.record("tool_a", () => 3);
    expect(recorder.callSequence).toEqual(["tool_a", "tool_b", "tool_a"]);
    expect(recorder.all.map((r) => r.sequenceIndex)).toEqual([0, 1, 2]);
  });

  it("records non-negative, finite latency", async () => {
    const recorder = new ToolCallRecorder();
    await recorder.record("slow_tool", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "done";
    });
    const trace = recorder.all[0]!;
    expect(Number.isFinite(trace.latencyMs)).toBe(true);
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("captures an error, still records exactly one trace, and re-throws", async () => {
    const recorder = new ToolCallRecorder();
    await expect(
      recorder.record("failing_tool", () => {
        throw new Error("tool exploded");
      }),
    ).rejects.toThrow("tool exploded");

    expect(recorder.all).toHaveLength(1);
    const trace = recorder.all[0]!;
    expect(trace.tool).toBe("failing_tool");
    expect(trace.error).toBe("tool exploded");
    expect(trace.resultCount).toBeNull();
  });

  it("never fabricates token usage: defaults to null when not supplied", async () => {
    const recorder = new ToolCallRecorder();
    await recorder.record("no_token_info_tool", () => "output");
    expect(recorder.all[0]!.tokenUsage).toBeNull();
  });

  it("passes through token usage only when the caller genuinely supplies it", async () => {
    const recorder = new ToolCallRecorder();
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    await recorder.record("llm_tool", () => "output", { tokenUsage: usage });
    expect(recorder.all[0]!.tokenUsage).toEqual(usage);
  });

  it("failed calls also keep tokenUsage null rather than guessing a value", async () => {
    const recorder = new ToolCallRecorder();
    await expect(
      recorder.record("failing_tool", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    expect(recorder.all[0]!.tokenUsage).toBeNull();
  });
});
