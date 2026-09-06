/**
 * Generic tool-call instrumentation: records tool name, call sequence,
 * result count, latency, and errors for any wrapped tool call. Token usage
 * is recorded ONLY when explicitly supplied by the caller (i.e. genuinely
 * exposed by the underlying runtime/API) — this module never estimates,
 * guesses, or fabricates a token count or monetary cost; unavailable usage
 * is represented as `null`, never `0` or an invented figure.
 */

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ToolInvocationRecord {
  readonly tool: string;
  /** Position of this call in the recorder's call sequence, 0-indexed. */
  readonly sequenceIndex: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly latencyMs: number;
  /** null when the call errored, or when the caller supplied no counter. */
  readonly resultCount: number | null;
  /** null on success; the error message on failure. */
  readonly error: string | null;
  /** null unless the runtime/API genuinely exposed usage for this call. */
  readonly tokenUsage: TokenUsage | null;
}

export interface RecordToolCallOptions<T> {
  readonly resultCount?: (output: T) => number;
  readonly tokenUsage?: TokenUsage | null;
}

/**
 * Ordered, append-only recorder of tool invocations. One instance per
 * predictor run (or per eval item) gives both the call sequence (tool names
 * in call order, via `callSequence`) and full per-call instrumentation
 * detail (via `all`).
 */
export class ToolCallRecorder {
  private readonly records: ToolInvocationRecord[] = [];
  private nextSequenceIndex = 0;

  get callSequence(): readonly string[] {
    return this.records.map((r) => r.tool);
  }

  get all(): readonly ToolInvocationRecord[] {
    return this.records;
  }

  /**
   * Wraps a single tool call. Always appends exactly one ToolInvocationRecord,
   * whether `fn` succeeds or throws. On failure, `error` is set, `resultCount`
   * is null (there is no result to count), and the original error is
   * re-thrown after recording — instrumentation must never swallow a real
   * failure or substitute a fabricated result.
   */
  async record<T>(
    toolName: string,
    fn: () => Promise<T> | T,
    options: RecordToolCallOptions<T> = {},
  ): Promise<T> {
    const sequenceIndex = this.nextSequenceIndex++;
    const startedAt = new Date();
    const startPerf = performance.now();
    try {
      const output = await fn();
      this.records.push({
        tool: toolName,
        sequenceIndex,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        latencyMs: performance.now() - startPerf,
        resultCount: options.resultCount ? options.resultCount(output) : null,
        error: null,
        tokenUsage: options.tokenUsage ?? null,
      });
      return output;
    } catch (err) {
      this.records.push({
        tool: toolName,
        sequenceIndex,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        latencyMs: performance.now() - startPerf,
        resultCount: null,
        error: err instanceof Error ? err.message : String(err),
        tokenUsage: options.tokenUsage ?? null,
      });
      throw err;
    }
  }
}
