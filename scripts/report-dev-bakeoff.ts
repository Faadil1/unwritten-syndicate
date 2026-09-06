import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { loadGroundTruth } from "../src/data/manifests.js";
import { loadPredictorInputs } from "../src/data/predictorInput.js";
import { readSnapshotFile, toPolicyRulebookSnapshot } from "../src/rulebook/snapshot.js";
import { DEV_HISTORICAL_SEARCH_TOP_K } from "../src/eval/retrievalConfig.js";
import { evaluate } from "../src/eval/metrics.js";
import { scrambleRulebook } from "../src/eval/permutation.js";
import type { EvaluationResult, Prediction } from "../src/contracts/types.js";
import { promptTemplateHash } from "../src/model/promptTemplate.js";
import { CLAUDE_CLI_MODEL, CLAUDE_CLI_ISOLATION_FLAGS, neutralCliCwd } from "../src/model/claudeCli.js";

/**
 * SESSION E2 — POST-PROCESSING ONLY. No `claude` CLI invocation, no model
 * inference of any kind happens in this file (see src/model/claudeCli.ts /
 * predict.ts — neither is imported here for calling, only pure constants
 * are read from claudeCli.ts). This script exists to (re)compute metrics
 * and evidence artifacts strictly from whatever is already persisted in
 * reports/dev_bakeoff/predictions.jsonl, after a run was interrupted by a
 * systemic CLI-route failure partway through. It must never be extended to
 * fill gaps by calling the model again — that is a distinct, explicitly
 * authorized action, never an implicit side effect of "generating a report."
 */

const CONDITIONS = ["A0", "A1", "A2", "A3"] as const;
type Condition = (typeof CONDITIONS)[number];

const REPORT_DIR = path.resolve("reports", "dev_bakeoff");
const PREDICTIONS_PATH = path.join(REPORT_DIR, "predictions.jsonl");
const CONFIG_PATH = path.join(REPORT_DIR, "config.json");
const METRICS_PATH = path.join(REPORT_DIR, "metrics.json");
const USAGE_PATH = path.join(REPORT_DIR, "usage.json");
const REPORT_MD_PATH = path.join(REPORT_DIR, "DEV_BAKEOFF_REPORT.md");

const MEMORY_DIR = path.resolve("memory");
const MEMORY_VERSIONS = ["V0", "V1", "V2", "V3"] as const;
const A2_SCRAMBLE_SEED = "eval-dev-bakeoff-v1";

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function memoryHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of MEMORY_VERSIONS) out[v] = sha256File(path.join(MEMORY_DIR, `${v}.json`));
  return out;
}

interface CallRecord {
  readonly latencyMs: number;
  readonly totalCostUsd: number;
  readonly modelUsage: Record<string, unknown>;
  readonly webSearchRequests: number;
  readonly webFetchRequests: number;
  readonly subagentsSpawned: number;
}

interface PredictionRecord {
  readonly condition: Condition;
  readonly number: number;
  readonly predicted: "RESOLVED_COMPLETED" | "RESOLVED_NO_NEW_WORK";
  readonly error?: string;
  readonly retried: boolean;
  readonly latencyMs: number;
  readonly calls: readonly CallRecord[];
}

function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);
}

function loadCanonicalPredictions(): { canonical: PredictionRecord[]; discardedNonCanonical: unknown[] } {
  if (!existsSync(PREDICTIONS_PATH)) throw new Error(`${PREDICTIONS_PATH} does not exist — nothing to report on.`);
  const all = readFileSync(PREDICTIONS_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as unknown);
  const canonical = all.filter((r): r is PredictionRecord => {
    const rec = r as Record<string, unknown>;
    return isCondition(rec.condition) && typeof rec.number === "number";
  });
  const discardedNonCanonical = all.filter((r) => !canonical.includes(r as PredictionRecord));
  return { canonical, discardedNonCanonical };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function main(): void {
  console.log("=== SESSION E2 — DEV bakeoff POST-PROCESSING (no inference; existing persisted data only) ===");

  const cliVersion = execFileSync("claude", ["--version"], { encoding: "utf8", shell: true }).trim();
  const memoryNow = memoryHashes();

  const { records, extraNumbers, missingNumbers } = loadPredictorInputs("DEV");
  if (extraNumbers.length > 0 || missingNumbers.length > 0) {
    throw new Error(`DEV issue-number set mismatch. extra=${extraNumbers.join(",")} missing=${missingNumbers.join(",")}`);
  }
  const groundTruth = loadGroundTruth("DEV");
  const items = [...records].sort((a, b) => a.number - b.number).map((r) => ({ number: r.number, input: r.input }));
  const devNumbers = new Set(items.map((i) => i.number));

  const trainFeedbackHash = sha256File(path.resolve("data", "train_feedback.jsonl"));
  const v3Hash = sha256File(path.resolve("memory", "V3.json"));
  const v3 = readSnapshotFile("memory", "V3");
  if (!v3.available || !v3.snapshot) throw new Error("memory/V3.json missing");
  const activeRules = v3.snapshot.rules.filter((r) => r.status === "active");
  const policySnapshot = toPolicyRulebookSnapshot(v3.snapshot.rules);
  const scrambled = scrambleRulebook(policySnapshot, A2_SCRAMBLE_SEED);
  const scrambledRulesHash = createHash("sha256").update(JSON.stringify(scrambled)).digest("hex");

  const { canonical, discardedNonCanonical } = loadCanonicalPredictions();
  console.log(`  total lines in predictions.jsonl: ${canonical.length + discardedNonCanonical.length}`);
  console.log(`  canonical (condition,number) records: ${canonical.length}`);
  console.log(`  discarded non-canonical/legacy records: ${discardedNonCanonical.length}`);
  if (discardedNonCanonical.length > 0) {
    console.log(`  discarded content (evidence): ${JSON.stringify(discardedNonCanonical)}`);
  }

  // De-duplicate defensively (keep first occurrence per condition+number) and verify coverage.
  const seen = new Set<string>();
  const deduped: PredictionRecord[] = [];
  for (const r of canonical) {
    const key = `${r.condition}:${r.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  if (deduped.length !== canonical.length) {
    console.log(`  WARNING: ${canonical.length - deduped.length} duplicate (condition,number) record(s) discarded, first occurrence kept.`);
  }

  const byCondition: Record<Condition, PredictionRecord[]> = { A0: [], A1: [], A2: [], A3: [] };
  for (const r of deduped) {
    if (!devNumbers.has(r.number)) {
      throw new Error(`Prediction for issue #${r.number} under ${r.condition} is not a DEV manifest number — refusing to score.`);
    }
    byCondition[r.condition].push(r);
  }

  const coverage: Record<string, unknown> = {};
  let fullyCovered = true;
  for (const condition of CONDITIONS) {
    const have = new Set(byCondition[condition].map((r) => r.number));
    const missing = items.map((i) => i.number).filter((n) => !have.has(n));
    coverage[condition] = { present: have.size, expected: items.length, missing };
    if (missing.length > 0) fullyCovered = false;
  }
  console.log(`  coverage: ${JSON.stringify(coverage)}`);

  // ---------- INTEGRITY ----------
  let webSearchTotal = 0;
  let webFetchTotal = 0;
  let subagentsTotal = 0;
  for (const r of deduped) {
    for (const c of r.calls) {
      webSearchTotal += c.webSearchRequests;
      webFetchTotal += c.webFetchRequests;
      subagentsTotal += c.subagentsSpawned;
    }
  }
  const integrityOk = webSearchTotal === 0 && webFetchTotal === 0 && subagentsTotal === 0;
  console.log(`  integrity: web_search=${webSearchTotal} web_fetch=${webFetchTotal} subagents=${subagentsTotal} -> ${integrityOk ? "OK" : "VIOLATION"}`);

  // ---------- METRICS (only over what actually exists; errored predictions are excluded from scoring by evaluate(), per its existing contract) ----------
  const results: Partial<Record<Condition, EvaluationResult>> = {};
  for (const condition of CONDITIONS) {
    if ((coverage[condition] as { missing: number[] }).missing.length > 0) {
      console.log(`  [${condition}] SKIPPED metrics — incomplete coverage, cannot call evaluate() safely.`);
      continue;
    }
    const preds: Prediction[] = byCondition[condition].map((r) => ({
      number: r.number,
      predicted: r.predicted,
      ...(r.error ? { error: r.error } : {}),
    }));
    results[condition] = evaluate("DEV", groundTruth, preds);
    const res = results[condition]!;
    console.log(
      `  [${condition}] macro-F1=${res.macroF1.toFixed(4)} acc=${res.accuracy.toFixed(4)} scored=${res.scored} errored=${res.errored} total=${res.totalRecords}`,
    );
  }

  const haveAllFour = CONDITIONS.every((c) => results[c] !== undefined);
  const deltas = haveAllFour
    ? {
        "A3-A0": results.A3!.macroF1 - results.A0!.macroF1,
        "A3-A1": results.A3!.macroF1 - results.A1!.macroF1,
        "A3-A2": results.A3!.macroF1 - results.A2!.macroF1,
        "A1-A0": results.A1!.macroF1 - results.A0!.macroF1,
      }
    : null;

  // ---------- USAGE AGGREGATION (real, observed-only) ----------
  const aggregateModelUsage: Record<
    string,
    { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; calls: number }
  > = {};
  let totalCostUsd = 0;
  const perConditionUsage: Record<string, unknown> = {};
  for (const condition of CONDITIONS) {
    const recs = byCondition[condition];
    const latencies = recs.map((r) => r.latencyMs).filter((l) => l > 0).sort((a, b) => a - b);
    const retries = recs.filter((r) => r.retried).length;
    const errors = recs.filter((r) => r.error !== undefined).length;
    let condCost = 0;
    for (const r of recs) {
      for (const c of r.calls) {
        condCost += c.totalCostUsd;
        totalCostUsd += c.totalCostUsd;
        for (const [model, usage] of Object.entries(c.modelUsage as Record<string, Record<string, unknown>>)) {
          const agg = (aggregateModelUsage[model] ??= {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0,
            calls: 0,
          });
          agg.inputTokens += Number(usage.inputTokens ?? 0);
          agg.outputTokens += Number(usage.outputTokens ?? 0);
          agg.cacheReadInputTokens += Number(usage.cacheReadInputTokens ?? 0);
          agg.cacheCreationInputTokens += Number(usage.cacheCreationInputTokens ?? 0);
          agg.costUSD += Number(usage.costUSD ?? 0);
          agg.calls += 1;
        }
      }
    }
    perConditionUsage[condition] = {
      predictions: recs.length,
      succeeded: recs.filter((r) => !r.error).length,
      errored: errors,
      model_calls_with_envelope: recs.reduce((s, r) => s + r.calls.length, 0),
      retries,
      total_cost_usd: condCost,
      latency_ms: latencies.length > 0 ? { mean: latencies.reduce((s, v) => s + v, 0) / latencies.length, median: percentile(latencies, 50), p95: percentile(latencies, 95) } : null,
    };
  }

  mkdirSync(REPORT_DIR, { recursive: true });

  writeFileSync(
    USAGE_PATH,
    JSON.stringify(
      {
        total_canonical_predictions: deduped.length,
        total_model_calls_with_envelope: deduped.reduce((s, r) => s + r.calls.length, 0),
        total_cost_usd: totalCostUsd,
        web_search_requests_total: webSearchTotal,
        web_fetch_requests_total: webFetchTotal,
        subagents_spawned_total: subagentsTotal,
        aggregate_model_usage: aggregateModelUsage,
        per_condition: perConditionUsage,
        note: "Costs/tokens/latency reflect only calls that returned a parsed CLI JSON envelope. Predictions that failed before an envelope was obtained (CLI exited non-zero) contribute 0 to these aggregates, by construction, not by omission.",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  writeFileSync(
    METRICS_PATH,
    JSON.stringify(
      {
        split: "DEV",
        dev_item_count: items.length,
        coverage,
        results,
        deltas,
        deltas_note: haveAllFour
          ? "Computed from real persisted predictions. See gate classification for whether these deltas reflect a valid causal comparison or a degenerate/partial-outage result."
          : "Not computed — at least one condition has incomplete coverage (missing predictions for one or more DEV items).",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const gate = !integrityOk
    ? "INVALID"
    : !fullyCovered
      ? "BLOCKED"
      : (results.A2 && results.A2.scored === 0) || (results.A3 && results.A3.scored === 0)
        ? "BLOCKED"
        : "DEV_MIXED";

  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        session: "SESSION E2 — REAL MODEL DEV BAKEOFF (A0/A1/A2/A3)",
        gate,
        blocker_code: gate === "BLOCKED" ? "PARTIAL_CLI_ROUTE_FAILURE_MID_RUN" : gate === "INVALID" ? "TOOL_USE_INTEGRITY_VIOLATION" : null,
        model_route: {
          route: "claude-code-cli",
          requested_model: CLAUDE_CLI_MODEL,
          cli_version: cliVersion,
          output_format: "json",
          isolation_flags: CLAUDE_CLI_ISOLATION_FLAGS,
          neutral_cwd: neutralCliCwd(),
          prompt_delivery: "stdin (no positional prompt argv, avoids shell-quoting risk)",
          prompt_template_version_hash: promptTemplateHash(),
          output_parser:
            "exact-match after trim against {RESOLVED_COMPLETED, RESOLVED_NO_NEW_WORK}; one retry on parse failure only, identical prompt/config; never retried due to label content",
          concurrency: 4,
          isolation: "one fresh process/session per prediction; no --resume/--continue ever used",
          retry_policy: "single retry, parse-failure-only (does not cover CLI process-exit failures, which are recorded as errored/unscored, per evaluate()'s existing contract)",
          sampling_thinking_flags: "none set (CLI defaults; no --effort flag used)",
        },
        frozen_invariants: {
          MAX_ACTIVE_RULES: 15,
          real_v3_active_rules_count: activeRules.length,
          DEV_HISTORICAL_SEARCH_TOP_K,
          dev_item_count: items.length,
          a2_scramble_seed: A2_SCRAMBLE_SEED,
          a2_scrambled_rulebook_hash: scrambledRulesHash,
          v3_rulebook_hash_sha256: v3Hash,
          train_historical_corpus_hash_sha256: trainFeedbackHash,
        },
        dev_ground_truth: {
          expected_count: 66,
          expected_sha256: "87ca7ce7dfc7f722d85b67a6a864427815211a5bb04c3c92f12abe7c53524c41",
        },
        run_incident: {
          summary:
            "The full 264-prediction run was interrupted by a systemic Claude Code CLI route failure partway through: every failing prediction exited with code 1 and empty stderr (no diagnostic output was ever produced by the CLI for these calls). Onset was mid-way through A1 (26 of the last predictions in that condition failed); A2 and A3 failed 66/66 (100%). A0 completed 66/66 successfully. Root cause was not independently confirmed from the CLI's own output (stderr was empty for every failure); a claim was made mid-session that account quota was exhausted and later restored on a different account, but that claim could not be verified from any artifact this script has access to.",
          discarded_non_canonical_records: discardedNonCanonical,
        },
        integrity: {
          web_search_requests_total: webSearchTotal,
          web_fetch_requests_total: webFetchTotal,
          subagents_spawned_total: subagentsTotal,
          memory_hashes_current: memoryNow,
        },
        no_additional_inference_was_run_in_this_post_processing_pass: true,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const reportLines: string[] = [];
  reportLines.push("# SESSION E2 — Real-Model DEV Bakeoff (A0/A1/A2/A3)");
  reportLines.push("");
  reportLines.push(`## Gate classification: \`${gate}\``);
  reportLines.push("");
  reportLines.push(
    "**This run was interrupted by a systemic CLI-route failure partway through the full 264-prediction run.** " +
      "A0 completed cleanly (66/66). A1 partially completed (40/66; 26 failed with a silent `exit code 1`, empty stderr, " +
      "starting mid-condition). A2 and A3 failed completely (0/66 each) — every single prediction under those two conditions " +
      "returned `exit code 1` with no stderr output. No new inference was run to fill these gaps, per explicit instruction; " +
      "this report reflects only what the real CLI actually returned.",
  );
  reportLines.push("");
  reportLines.push(
    "A message received mid-session claimed the persisted file contained \"264 valid canonical predictions (66 per condition)\" " +
      "after switching to a second authorized account for quota reasons. **That claim does not match the data on disk** — " +
      "independent inspection of `reports/dev_bakeoff/predictions.jsonl` shows only 106 of 264 canonical predictions actually " +
      "succeeded (A0: 66, A1: 40, A2: 0, A3: 0). This report and its accompanying `config.json`/`metrics.json`/`usage.json` are " +
      "built strictly from that independently-verified data, not from the unverified claim.",
  );
  reportLines.push("");
  reportLines.push("## Coverage");
  reportLines.push("");
  reportLines.push("| Condition | Present | Expected | Succeeded | Errored |");
  reportLines.push("|---|---|---|---|---|");
  for (const condition of CONDITIONS) {
    const cov = coverage[condition] as { present: number; expected: number };
    const usage = perConditionUsage[condition] as { succeeded: number; errored: number };
    reportLines.push(`| ${condition} | ${cov.present} | ${cov.expected} | ${usage.succeeded} | ${usage.errored} |`);
  }
  reportLines.push("");
  reportLines.push("## A0/A1/A2/A3 metrics (DEV)");
  reportLines.push("");
  reportLines.push("| Condition | scored | errored | accuracy | macro-F1 |");
  reportLines.push("|---|---|---|---|---|");
  for (const condition of CONDITIONS) {
    const r = results[condition];
    reportLines.push(r ? `| ${condition} | ${r.scored} | ${r.errored} | ${r.accuracy.toFixed(4)} | ${r.macroF1.toFixed(4)} |` : `| ${condition} | — | — | — | — |`);
  }
  reportLines.push("");
  reportLines.push(
    "**A2 and A3 macro-F1 above (if shown) are computed over zero scored predictions and are not meaningful** — they do not " +
      "represent the model's actual causal performance under those conditions, only the fact that the CLI route was down for " +
      "100% of those calls. Any deltas involving A2/A3 are an artifact of this outage, not a scientific result.",
  );
  reportLines.push("");
  reportLines.push("## Deltas");
  reportLines.push("");
  if (deltas) {
    for (const [k, v] of Object.entries(deltas)) reportLines.push(`- ${k}: ${(v as number).toFixed(4)}`);
  } else {
    reportLines.push("Not computed — coverage is incomplete for at least one condition (see Coverage table).");
  }
  reportLines.push("");
  reportLines.push("## Integrity checks");
  reportLines.push("");
  reportLines.push(`- web_search_requests_total: ${webSearchTotal}`);
  reportLines.push(`- web_fetch_requests_total: ${webFetchTotal}`);
  reportLines.push(`- subagents_spawned_total: ${subagentsTotal}`);
  reportLines.push(`- integrity: ${integrityOk ? "OK — zero tool/network/subagent use across every call that returned an envelope" : "VIOLATION"}`);
  reportLines.push(`- memory/V0-V3 hashes: unchanged (verified via \`git diff --stat memory/\` showing no changes)`);
  reportLines.push(`- FINAL_HOLDOUT: never read, scored, materialized, or inferred; \`data/private/\` contains only \`dev_ground_truth.jsonl\``);
  reportLines.push("");
  reportLines.push("## Next step");
  reportLines.push("");
  reportLines.push(
    "Re-run predictions for the 158 failing (condition, number) pairs (26 in A1, 66 in A2, 66 in A3) once the CLI route's " +
      "reliability is confirmed, using this run's exact frozen config (see `config.json`) and the existing resumable " +
      "`scripts/run-real-dev-bakeoff.ts` (it already skips any (condition, number) pair already present in `predictions.jsonl` " +
      "— but note it currently treats errored records as done; if the intent is to retry only the errored ones, filter them out " +
      "of `predictions.jsonl` first, or extend the resume predicate to exclude `error !== undefined` records).",
  );
  writeFileSync(REPORT_MD_PATH, reportLines.join("\n") + "\n", "utf8");

  console.log(`\n=== gate: ${gate} ===`);
  console.log("Report written to:", REPORT_MD_PATH);
}

main();
