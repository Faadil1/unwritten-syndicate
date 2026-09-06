import type { ResolutionDisposition } from "../contracts/types.js";
import { invokeClaudeCliOnce, type ClaudeCliCallResult } from "./claudeCli.js";
import { RESOLUTION_LABELS } from "./promptTemplate.js";

function parseLabel(text: string): ResolutionDisposition | null {
  const trimmed = text.trim();
  return (RESOLUTION_LABELS as readonly string[]).includes(trimmed) ? (trimmed as ResolutionDisposition) : null;
}

export interface PredictWithCliResult {
  readonly disposition: ResolutionDisposition;
  readonly retried: boolean;
  readonly parseFailureAfterRetry: boolean;
  /** One entry per underlying CLI invocation (1, or 2 if a parser-failure retry occurred). */
  readonly calls: readonly ClaudeCliCallResult[];
}

/**
 * Runs one isolated real-model prediction: a fresh `claude -p` process, then
 * a strict label parse. Per the frozen retry policy: a parser failure (the
 * model returned anything other than exactly one of the two labels, after
 * trimming) is eligible for exactly one retry with the identical
 * prompt/config — never more, and never a retry just because the label
 * itself seems wrong. If the retry also fails to parse, this returns a
 * PARSE_FAILURE_AFTER_RETRY-flagged result; the caller records that item as
 * an unscored error, never fabricating a label.
 */
export async function predictWithCli(prompt: string): Promise<PredictWithCliResult> {
  const first = await invokeClaudeCliOnce(prompt);
  const firstLabel = parseLabel(first.resultText);
  if (firstLabel) {
    return { disposition: firstLabel, retried: false, parseFailureAfterRetry: false, calls: [first] };
  }

  const retry = await invokeClaudeCliOnce(prompt);
  const retryLabel = parseLabel(retry.resultText);
  if (retryLabel) {
    return { disposition: retryLabel, retried: true, parseFailureAfterRetry: false, calls: [first, retry] };
  }

  return {
    disposition: "RESOLVED_COMPLETED", // placeholder; parseFailureAfterRetry marks this unscored
    retried: true,
    parseFailureAfterRetry: true,
    calls: [first, retry],
  };
}
